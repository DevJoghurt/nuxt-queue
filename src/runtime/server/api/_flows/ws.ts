import {
  defineWebSocketHandler,
  useEventStore,
  registerWsPeer,
  unregisterWsPeer,
  useServerLogger,
} from '#imports'

interface PeerContext {
  subscriptions: Map<string, () => void> // streamName -> unsubscribe function
}

const logger = useServerLogger('api-flows-ws')

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
 *   "type": "error",
 *   "message": "error description"
 * }
 */
export default defineWebSocketHandler({
  open(peer) {
    logger.info('[ws] client connected:', { peerId: peer.id })

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

      const store = useEventStore()
      const names = store.names()
      const flowStream = names.flow(runId)
      const subscriptionKey = `${flowName}:${runId}`

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

      // Subscribe to stream store events
      const unsub = store.subscribe(flowStream, async (event: any) => {
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

      context.subscriptions.set(subscriptionKey, unsub)

      // Send historical events (backfill)
      try {
        const historicalEvents = await store.read(flowStream, {
          limit: 100,
          direction: 'forward',
        })

        safeSend(peer, {
          type: 'history',
          flowName,
          runId,
          events: historicalEvents.map(e => ({
            v: 1,
            eventType: (e as any).kind || e.type,
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

      const subscriptionKey = `${flowName}:${runId}`
      const unsub = context.subscriptions.get(subscriptionKey)

      if (unsub) {
        try {
          unsub()
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

  close(peer, event) {
    const isNormalClosure = event?.code === 1000 || event?.code === 1001
    if (!isNormalClosure) {
      logger.info('[ws] client disconnected:', { peerId: peer.id, code: event?.code, reason: event?.reason })
    }

    // Unregister peer from lifecycle tracking
    unregisterWsPeer(peer)

    const context = peerContexts.get(peer)
    if (context) {
      // Unsubscribe from all streams
      for (const unsub of context.subscriptions.values()) {
        try {
          unsub()
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

  error(peer, error) {
    logger.error('[ws] error for peer:', { peerId: peer.id, error })

    // Unregister peer from lifecycle tracking
    unregisterWsPeer(peer)

    const context = peerContexts.get(peer)
    if (context) {
      // Cleanup on error
      for (const unsub of context.subscriptions.values()) {
        try {
          unsub()
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
