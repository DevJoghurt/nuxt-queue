import {
  defineWebSocketHandler,
  usePeerManager,
  useNventLogger,
  useStreamAdapter,
  useStoreAdapter,
  useStreamTopics,
} from '#imports'

import type { SubscriptionHandle } from '#nvent/adapters'

interface PeerContext {
  subscriptions: Map<string, SubscriptionHandle> // triggerName -> subscription handle
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
          await existingHandle.unsubscribe()
        }
        catch (err) {
          logger.error('[ws] error unsubscribing:', { error: err })
        }
      }

      // Subscribe to trigger stream pub/sub topic
      const { SubjectPatterns, getTriggerEventTopic } = useStreamTopics()
      const streamTopic = getTriggerEventTopic(triggerName)
      const storeSubject = SubjectPatterns.trigger(triggerName)

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
        const historicalEvents = await store.read(storeSubject, {
          limit: 100,
          order: 'desc', // Most recent first
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
          await handle.unsubscribe()
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
      for (const handle of Array.from(context.subscriptions.values())) {
        try {
          await handle.unsubscribe()
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
      for (const handle of Array.from(context.subscriptions.values())) {
        try {
          await handle.unsubscribe()
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
