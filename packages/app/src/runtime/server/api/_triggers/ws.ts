import {
  defineWebSocketHandler,
  usePeerManager,
  useNventLogger,
  useStreamAdapter,
  useStoreAdapter,
  useStreamTopics,
  useTrigger,
} from '#imports'

import type { SubscriptionHandle } from '#nvent/adapters'

interface PeerContext {
  subscriptions: Map<string, (() => void) | SubscriptionHandle> // subscription key -> unsubscribe function or handle
}

const peerContexts = new WeakMap<any, PeerContext>()

/**
 * Safely send a message to a peer, ignoring ECONNRESET errors
 * during HMR or connection closure
 */
function safeSend(peer: any, data: any): boolean {
  try {
    peer.send(JSON.stringify(data))
    return true
  }
  catch {
    // Silently ignore connection errors (ECONNRESET, connection closed, etc.)
    // These are expected during HMR or when client disconnects
    return false
  }
}

/**
 * WebSocket endpoint for trigger events
 * Supports subscribing to specific triggers and receiving real-time updates
 *
 * Message format (client -> server):
 * {
 *   "type": "subscribe",
 *   "triggerName": "user.created"
 * }
 *
 * {
 *   "type": "unsubscribe",
 *   "triggerName": "user.created"
 * }
 *
 * {
 *   "type": "ping"
 * }
 *
 * {
 *   "type": "subscribe.stats"
 * }
 *
 * {
 *   "type": "unsubscribe.stats"
 * }
 *
 * Message format (server -> client):
 * {
 *   "type": "event",
 *   "triggerName": "user.created",
 *   "event": { type: "...", data: {...}, timestamp: ... }
 * }
 *
 * {
 *   "type": "history",
 *   "triggerName": "user.created",
 *   "events": [ ...historicalEvents ]
 * }
 *
 * {
 *   "type": "subscribed",
 *   "triggerName": "user.created"
 * }
 *
 * {
 *   "type": "unsubscribed",
 *   "triggerName": "user.created"
 * }
 *
 * {
 *   "type": "trigger.stats.initial",
 *   "data": { id: "triggerName", metadata: {...} },
 *   "timestamp": 1234567890
 * }
 *
 * {
 *   "type": "trigger.stats.update",
 *   "data": { id: "triggerName", metadata: {...} },
 *   "timestamp": 1234567890
 * }
 *
 * {
 *   "type": "pong",
 *   "timestamp": 1234567890
 * }
 *
 * {
 *   "type": "error",
 *   "message": "error description"
 * }
 */
export default defineWebSocketHandler({
  async open(peer) {
    const logger = useNventLogger('api-triggers-ws')
    logger.info('[ws] client connected:', { peerId: peer.id })

    const { registerWsPeer } = usePeerManager()

    // Register peer for graceful shutdown during HMR
    registerWsPeer(peer)

    // Initialize peer context
    peerContexts.set(peer, {
      subscriptions: new Map(),
    })

    // Send welcome message
    safeSend(peer, {
      type: 'connected',
      timestamp: Date.now(),
    })
  },

  async message(peer, message) {
    const logger = useNventLogger('api-triggers-ws')
    const context = peerContexts.get(peer)
    if (!context) {
      logger.error('[ws] no context for peer:', { peerId: peer.id })
      return
    }

    let data: any
    try {
      data = JSON.parse(message.text())
    }
    catch {
      // Silently ignore parse errors during connection close
      safeSend(peer, {
        type: 'error',
        message: 'Invalid JSON',
      })
      return
    }

    const { type, triggerName } = data

    if (type === 'subscribe') {
      if (!triggerName) {
        safeSend(peer, {
          type: 'error',
          message: 'Missing triggerName',
        })
        return
      }

      // Check if adapters are initialized
      let stream: any
      let store: any
      try {
        stream = useStreamAdapter()
        store = useStoreAdapter()
      }
      catch (err) {
        logger.error('[ws] Adapters not initialized yet:', { error: err })
        safeSend(peer, {
          type: 'error',
          message: 'Server initializing, please retry',
        })
        return
      }

      // Unsubscribe from any existing subscription with same key
      const existingHandle = context.subscriptions.get(triggerName)
      if (existingHandle) {
        try {
          if (typeof existingHandle === 'function') {
            await existingHandle()
          }
          else {
            await existingHandle.unsubscribe()
          }
        }
        catch (err) {
          logger.error('[ws] error unsubscribing:', { error: err })
        }
      }

      // Subscribe to StreamAdapter for real-time trigger events
      const { StoreSubjects, StreamTopics } = useStreamTopics()
      const streamTopic = StreamTopics.triggerEvents(triggerName)
      const storeSubject = StoreSubjects.triggerStream(triggerName)

      // Subscribe to trigger stream for real-time updates
      const handle = await stream.subscribe(streamTopic, async (message: any) => {
        // message.data.event contains the trigger event
        const event = message.data?.event
        if (!event) {
          logger.warn('[ws] Received message without event data:', message)
          return
        }

        safeSend(peer, {
          type: 'event',
          triggerName,
          event,
        })
      })

      context.subscriptions.set(triggerName, handle)

      // Send historical events (backfill) from StoreAdapter
      try {
        const historicalEvents = await store.stream.read(storeSubject, {
          limit: 100,
          order: 'asc', // Forward order to match flows
        })

        safeSend(peer, {
          type: 'history',
          triggerName,
          events: historicalEvents || [],
        })
      }
      catch (err) {
        logger.error('[ws] error sending history:', { error: err })
        safeSend(peer, {
          type: 'error',
          message: 'Failed to load history',
        })
      }

      // Confirm subscription
      safeSend(peer, {
        type: 'subscribed',
        triggerName,
      })
    }
    else if (type === 'unsubscribe') {
      if (!triggerName) {
        safeSend(peer, {
          type: 'error',
          message: 'Missing triggerName',
        })
        return
      }

      const handle = context.subscriptions.get(triggerName)

      if (handle) {
        try {
          if (typeof handle === 'function') {
            await handle()
          }
          else {
            await handle.unsubscribe()
          }
          context.subscriptions.delete(triggerName)

          safeSend(peer, {
            type: 'unsubscribed',
            triggerName,
          })
        }
        catch (err) {
          logger.error('[ws] error unsubscribing:', { error: err })
          safeSend(peer, {
            type: 'error',
            message: 'Failed to unsubscribe',
          })
        }
      }
    }
    else if (type === 'subscribe.stats') {
      // Subscribe to trigger stats updates (trigger index changes)
      const statsKey = 'stats'

      // Check if already subscribed
      const existingUnsub = context.subscriptions.get(statsKey)
      if (existingUnsub) {
        safeSend(peer, {
          type: 'error',
          message: 'Already subscribed to stats',
        })
        return
      }

      try {
        const stream = useStreamAdapter()
        const { StreamTopics } = useStreamTopics()
        const topic = StreamTopics.triggerStats()

        const handle = await stream.subscribe(topic, (message: any) => {
          safeSend(peer, {
            type: 'trigger.stats.update',
            data: message,
            timestamp: Date.now(),
          })
        })

        // Store unsubscribe function
        const unsub = async () => {
          try {
            await handle.unsubscribe()
          }
          catch (err) {
            logger.error('[ws] error in stats unsub:', { error: err })
          }
        }

        context.subscriptions.set(statsKey, unsub)

        // Send all current stats immediately after subscription
        try {
          const trigger = useTrigger()
          const allTriggers = trigger.getAllTriggers()
          const { getSubscribedFlows, getTriggerStats } = trigger

          if (allTriggers && allTriggers.length > 0) {
            for (const triggerEntry of allTriggers) {
              const subscribedFlows = getSubscribedFlows(triggerEntry.name)
              const stats = await getTriggerStats(triggerEntry.name)

              safeSend(peer, {
                type: 'trigger.stats.initial',
                data: {
                  id: triggerEntry.name,
                  metadata: {
                    'name': triggerEntry.name,
                    'type': triggerEntry.type,
                    'scope': triggerEntry.scope,
                    'displayName': triggerEntry.displayName,
                    'description': triggerEntry.description,
                    'source': triggerEntry.source,
                    'status': triggerEntry.status || 'active',
                    'registeredAt': triggerEntry.registeredAt,
                    'lastActivityAt': triggerEntry.lastActivityAt,
                    'webhook': triggerEntry.webhook,
                    'schedule': triggerEntry.schedule,
                    'config': triggerEntry.config,
                    'subscribedFlows': subscribedFlows,
                    'subscriptionCount': subscribedFlows.length,
                    'stats.totalFires': stats?.totalFires || 0,
                    'stats.totalFlowsStarted': stats?.totalFlowsStarted || 0,
                    'stats.activeSubscribers': stats?.activeSubscribers || subscribedFlows.length,
                    'stats.lastFiredAt': stats?.lastFiredAt,
                  },
                },
                timestamp: Date.now(),
              })
            }
          }
        }
        catch (err) {
          logger.error('[ws] error fetching initial trigger stats:', { error: err })
        }

        safeSend(peer, {
          type: 'stats.subscribed',
          timestamp: Date.now(),
        })
      }
      catch (err) {
        logger.error('[ws] error subscribing to stats:', { error: err })
        safeSend(peer, {
          type: 'error',
          message: 'Failed to subscribe to stats',
        })
      }
    }
    else if (type === 'unsubscribe.stats') {
      // Unsubscribe from trigger stats
      const statsKey = 'stats'
      const unsub = context.subscriptions.get(statsKey)

      if (unsub) {
        try {
          if (typeof unsub === 'function') {
            await unsub()
          }
          else {
            await unsub.unsubscribe()
          }
          context.subscriptions.delete(statsKey)

          safeSend(peer, {
            type: 'stats.unsubscribed',
            timestamp: Date.now(),
          })
        }
        catch (err) {
          logger.error('[ws] error unsubscribing from stats:', { error: err })
          safeSend(peer, {
            type: 'error',
            message: 'Failed to unsubscribe from stats',
          })
        }
      }
    }
    else if (type === 'ping') {
      safeSend(peer, {
        type: 'pong',
        timestamp: Date.now(),
      })
    }
    else {
      safeSend(peer, {
        type: 'error',
        message: `Unknown message type: ${type}`,
      })
    }
  },

  async close(peer, event) {
    const logger = useNventLogger('api-triggers-ws')
    const isNormalClosure = event?.code === 1000 || event?.code === 1001
    if (!isNormalClosure) {
      logger.info('[ws] client disconnected:', { peerId: peer.id, code: event?.code, reason: event?.reason })
    }
    const { unregisterWsPeer } = usePeerManager()

    // Unregister peer from lifecycle tracking
    unregisterWsPeer(peer)

    const context = peerContexts.get(peer)
    if (context) {
      // Unsubscribe from all streams
      for (const handleOrUnsub of Array.from(context.subscriptions.values())) {
        try {
          if (typeof handleOrUnsub === 'function') {
            await handleOrUnsub()
          }
          else {
            await handleOrUnsub.unsubscribe()
          }
        }
        catch (err) {
          // Suppress errors during normal closure
          if (!isNormalClosure) {
            logger.error('[ws] error unsubscribing on close:', { error: err })
          }
        }
      }
      context.subscriptions.clear()
      peerContexts.delete(peer)
    }
  },

  async error(peer, error) {
    const logger = useNventLogger('api-triggers-ws')
    logger.error('[ws] error for peer:', { peerId: peer.id, error })

    const { unregisterWsPeer } = usePeerManager()

    // Unregister peer from lifecycle tracking
    unregisterWsPeer(peer)

    const context = peerContexts.get(peer)
    if (context) {
      // Cleanup on error
      for (const handleOrUnsub of Array.from(context.subscriptions.values())) {
        try {
          if (typeof handleOrUnsub === 'function') {
            await handleOrUnsub()
          }
          else {
            await handleOrUnsub.unsubscribe()
          }
        }
        catch (err) {
          logger.error('[ws] error unsubscribing on error:', { error: err })
        }
      }
      context.subscriptions.clear()
      peerContexts.delete(peer)
    }
  },
})
