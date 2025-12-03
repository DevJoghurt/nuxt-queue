import {
  defineWebSocketHandler,
  usePeerManager,
  useNventLogger,
  useStreamAdapter,
  useStoreAdapter,
  useStreamTopics,
  useFlow,
} from '#imports'

interface PeerContext {
  subscriptions: Map<string, () => void> // subscription key -> unsubscribe function
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
 * WebSocket endpoint for flow run events
 * Supports subscribing to specific flow runs and receiving real-time updates
 *
 * Message format (client -> server):
 * {
 *   "type": "subscribe",
 *   "flowName": "example",
 *   "runId": "abc123"
 * }
 *
 * {
 *   "type": "unsubscribe",
 *   "flowName": "example",
 *   "runId": "abc123"
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
 * {
 *   "type": "ping"
 * }
 *
 * Message format (server -> client):
 * {
 *   "type": "event",
 *   "flowName": "example",
 *   "runId": "abc123",
 *   "event": { v: 1, eventType: "...", record: {...} }
 * }
 *
 * {
 *   "type": "history",
 *   "flowName": "example",
 *   "runId": "abc123",
 *   "events": [ ...historicalEvents ]
 * }
 *
 * {
 *   "type": "subscribed",
 *   "flowName": "example",
 *   "runId": "abc123"
 * }
 *
 * {
 *   "type": "unsubscribed",
 *   "flowName": "example",
 *   "runId": "abc123"
 * }
 *
 * {
 *   "type": "pong",
 *   "timestamp": 1234567890
 * }
 *
 * {
 *   "type": "flow.stats.initial",
 *   "data": { id: "flowName", metadata: {...} },
 *   "timestamp": 1234567890
 * }
 *
 * {
 *   "type": "flow.stats.update",
 *   "data": { id: "flowName", metadata: {...} },
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
    const logger = useNventLogger('api-flows-ws')
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
    const logger = useNventLogger('api-flows-ws')
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
      // This can happen if we receive a partial message during shutdown
      safeSend(peer, {
        type: 'error',
        message: 'Invalid JSON',
      })
      return
    }

    const { type, flowName, runId } = data

    if (type === 'subscribe') {
      if (!flowName || !runId) {
        safeSend(peer, {
          type: 'error',
          message: 'Missing flowName or runId',
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
      const subscriptionKey = `flow:${flowName}:${runId}`

      // Unsubscribe from any existing subscription with same key
      const existingUnsub = context.subscriptions.get(subscriptionKey)
      if (existingUnsub) {
        try {
          existingUnsub()
        }
        catch (err) {
          logger.error('[ws] error unsubscribing:', { error: err })
        }
      }

      // Subscribe to StreamAdapter for real-time flow events
      const { StoreSubjects, StreamTopics } = useStreamTopics()

      // Store subject for historical events
      const subject = StoreSubjects.flowRun(runId)

      // Stream topic for real-time updates
      const topic = StreamTopics.flowEvents(runId)
      const handle = await stream.subscribe(topic, async (message: any) => {
        // message.data.event contains the flow event
        const event = message.data?.event
        if (!event) {
          logger.warn('[ws] Received message without event data:', message)
          return
        }

        safeSend(peer, {
          type: 'event',
          flowName,
          runId,
          event: {
            v: 1,
            eventType: event.type,
            record: event,
          },
        })
      })

      // Store unsubscribe function
      const unsub = async () => {
        try {
          await handle.unsubscribe()
        }
        catch (err) {
          logger.error('[ws] error in unsub:', { error: err })
        }
      }

      context.subscriptions.set(subscriptionKey, unsub)

      // Send historical events (backfill) from StoreAdapter
      try {
        const historicalEvents = await store.stream.read(subject, {
          limit: 100,
          order: 'asc', // forward order
        })

        safeSend(peer, {
          type: 'history',
          flowName,
          runId,
          events: historicalEvents.map((e: any) => ({
            v: 1,
            eventType: e.kind || e.type,
            record: e,
          })),
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
        flowName,
        runId,
      })
    }
    else if (type === 'unsubscribe') {
      if (!flowName || !runId) {
        safeSend(peer, {
          type: 'error',
          message: 'Missing flowName or runId',
        })
        return
      }

      const subscriptionKey = `flow:${flowName}:${runId}`
      const unsub = context.subscriptions.get(subscriptionKey)

      if (unsub) {
        try {
          await unsub()
          context.subscriptions.delete(subscriptionKey)

          safeSend(peer, {
            type: 'unsubscribed',
            flowName,
            runId,
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
      // Subscribe to flow stats updates (flow index changes)
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
        const topic = StreamTopics.flowStats()

        const handle = await stream.subscribe(topic, (message: any) => {
          safeSend(peer, {
            type: 'flow.stats.update',
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

        // Send all current stats immediately after subscription (like queues pattern)
        try {
          const flow = useFlow()
          const allFlowStats = await flow.getAllFlowStats()

          if (allFlowStats && allFlowStats.length > 0) {
            for (const flowStat of allFlowStats) {
              safeSend(peer, {
                type: 'flow.stats.initial',
                data: {
                  id: flowStat.name,
                  metadata: {
                    name: flowStat.name,
                    displayName: flowStat.displayName,
                    registeredAt: flowStat.registeredAt,
                    lastRunAt: flowStat.lastRunAt,
                    lastCompletedAt: flowStat.lastCompletedAt,
                    stats: {
                      total: flowStat.stats.total,
                      success: flowStat.stats.success,
                      failure: flowStat.stats.failure,
                      cancel: flowStat.stats.cancel,
                      running: flowStat.stats.running,
                      awaiting: flowStat.stats.awaiting,
                    },
                    version: flowStat.version,
                  },
                },
                timestamp: Date.now(),
              })
            }
          }
        }
        catch (err) {
          logger.error('[ws] error fetching initial stats:', { error: err })
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
      // Unsubscribe from flow stats
      const statsKey = 'stats'
      const unsub = context.subscriptions.get(statsKey)

      if (unsub) {
        try {
          await unsub()
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
    const logger = useNventLogger('api-flows-ws')
    const isNormalClosure = event?.code === 1000 || event?.code === 1001
    if (!isNormalClosure) {
      logger.info('[ws] client disconnected:', { peerId: peer.id, code: event?.code, reason: event?.reason })
    }
    const { unregisterWsPeer } = usePeerManager()

    // Unregister peer from lifecycle tracking
    unregisterWsPeer(peer)

    const context = peerContexts.get(peer)
    if (context) {
      // Unsubscribe from all subscriptions
      for (const unsub of Array.from(context.subscriptions.values())) {
        try {
          await unsub()
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
    const logger = useNventLogger('api-flows-ws')
    logger.error('[ws] error for peer:', { peerId: peer.id, error })

    const { unregisterWsPeer } = usePeerManager()

    // Unregister peer from lifecycle tracking
    unregisterWsPeer(peer)

    const context = peerContexts.get(peer)
    if (context) {
      // Cleanup on error
      for (const unsub of Array.from(context.subscriptions.values())) {
        try {
          await unsub()
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
