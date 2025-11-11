  defineWebSocketHandler,
  usePeerManager,
  useNventLogger,
  useStreamAdapter,
  useStoreAdapter,
  getStoreAppendTopic,
  SubjectPatterns,
} from '#imports'

import type { SubscriptionHandle } from '../../adapters/interfaces/stream'

interface PeerContext {
  subscriptions: Map<string, SubscriptionHandle> // streamName -> subscription handle
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

      const stream = useStreamAdapter()
      const store = useStoreAdapter()
      const subscriptionKey = `${flowName}:${runId}`

      // Unsubscribe from any existing subscription with same key
      const existingHandle = context.subscriptions.get(subscriptionKey)
      if (existingHandle) {
        try {
          await existingHandle.unsubscribe()
        }
        catch (err) {
          logger.error('[ws] error unsubscribing:', { error: err })
        }
      }

      // Subscribe to StreamAdapter for cross-instance real-time updates
      // Topic published by StoreAdapter when new events arrive
      const subject = SubjectPatterns.flowRun(runId)
      const topic = getStoreAppendTopic(subject)
      const handle = await stream.subscribe(topic, async (message: any) => {
        // message.data.event contains the appended event
        const event = message.data?.event
        if (!event) {
          console.warn('[ws] Received message without event data:', message)
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

      context.subscriptions.set(subscriptionKey, handle)

      // Send historical events (backfill) from StoreAdapter
      try {
        const historicalEvents = await store.read(subject, {
          limit: 100,
          order: 'asc', // forward order
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
      const handle = context.subscriptions.get(subscriptionKey)

      if (handle) {
        try {
          await handle.unsubscribe()
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
    const logger = useNventLogger('api-flows-ws')
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
