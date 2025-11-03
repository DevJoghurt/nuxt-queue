import {
  defineWebSocketHandler,
  useQueue,
  registerWsPeer,
  unregisterWsPeer,
} from '#imports'

interface PeerContext {
  subscriptions: Map<string, () => void> // queueName -> unsubscribe function
}

const peerContexts = new WeakMap<any, PeerContext>()

/**
 * Safely send a message to a peer, ignoring connection errors
 */
function safeSend(peer: any, data: any): boolean {
  try {
    peer.send(JSON.stringify(data))
    return true
  }
  catch {
    // Silently ignore connection errors (ECONNRESET, connection closed, etc.)
    return false
  }
}

/**
 * WebSocket endpoint for queue events
 * Supports subscribing to specific queues and receiving real-time job updates
 *
 * Message format (client -> server):
 * {
 *   "type": "subscribe",
 *   "queueName": "test"
 * }
 *
 * {
 *   "type": "unsubscribe",
 *   "queueName": "test"
 * }
 *
 * {
 *   "type": "ping"
 * }
 *
 * Message format (server -> client):
 * {
 *   "type": "event",
 *   "queueName": "test",
 *   "event": { eventType: "waiting|active|completed|failed", jobId: "...", ... }
 * }
 *
 * {
 *   "type": "subscribed",
 *   "queueName": "test"
 * }
 *
 * {
 *   "type": "unsubscribed",
 *   "queueName": "test"
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
    console.log('[ws:queues] client connected:', peer.id)

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
      console.error('[ws:queues] no context for peer:', peer.id)
      return
    }

    let data: any
    try {
      data = JSON.parse(message.text())
    }
    catch {
      safeSend(peer, {
        type: 'error',
        message: 'Invalid JSON',
      })
      return
    }

    const { type, queueName } = data

    if (type === 'subscribe') {
      if (!queueName) {
        safeSend(peer, {
          type: 'error',
          message: 'Missing queueName',
        })
        return
      }

      const queue = useQueue()

      // Unsubscribe from any existing subscription with same key
      const existingUnsub = context.subscriptions.get(queueName)
      if (existingUnsub) {
        try {
          existingUnsub()
        }
        catch (err) {
          console.error('[ws:queues] error unsubscribing:', err)
        }
      }

      // Subscribe to queue events
      const events: Array<'waiting' | 'active' | 'completed' | 'failed' | 'progress'> = [
        'waiting',
        'active',
        'completed',
        'failed',
        'progress',
      ]

      const unsubs = events.map(eventType =>
        queue.on(queueName, eventType, async (payload: any) => {
          // Send the event
          safeSend(peer, {
            type: 'event',
            queueName,
            event: {
              eventType,
              ...payload,
            },
          })

          // Send updated counts after state-changing events
          if (['waiting', 'active', 'completed', 'failed'].includes(eventType)) {
            try {
              const counts = await queue.getJobCounts(queueName)
              safeSend(peer, {
                type: 'counts',
                queueName,
                counts,
              })
            }
            catch (err) {
              console.error('[ws:queues] error fetching counts after event:', err)
            }
          }
        }),
      )

      // Combine all unsubscribe functions
      const unsub = () => {
        for (const u of unsubs) {
          try {
            u()
          }
          catch (err) {
            console.error('[ws:queues] error unsubscribing:', err)
          }
        }
      }

      context.subscriptions.set(queueName, unsub)

      // Send current counts immediately after subscription
      try {
        const counts = await queue.getJobCounts(queueName)
        safeSend(peer, {
          type: 'counts',
          queueName,
          counts,
        })
      }
      catch (err) {
        console.error('[ws:queues] error fetching counts:', err)
      }

      // Confirm subscription
      safeSend(peer, {
        type: 'subscribed',
        queueName,
      })
    }
    else if (type === 'unsubscribe') {
      if (!queueName) {
        safeSend(peer, {
          type: 'error',
          message: 'Missing queueName',
        })
        return
      }

      const unsub = context.subscriptions.get(queueName)

      if (unsub) {
        try {
          unsub()
          context.subscriptions.delete(queueName)

          safeSend(peer, {
            type: 'unsubscribed',
            queueName,
          })
        }
        catch (err) {
          console.error('[ws:queues] error unsubscribing:', err)
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
      console.log('[ws:queues] client disconnected:', peer.id, event?.code, event?.reason)
    }

    // Unregister peer from lifecycle tracking
    unregisterWsPeer(peer)

    const context = peerContexts.get(peer)
    if (context) {
      // Unsubscribe from all queues
      for (const unsub of context.subscriptions.values()) {
        try {
          unsub()
        }
        catch (err) {
          if (!isNormalClosure) {
            console.error('[ws:queues] error unsubscribing on close:', err)
          }
        }
      }
      context.subscriptions.clear()
      peerContexts.delete(peer)
    }
  },

  error(peer, error) {
    console.error('[ws:queues] error for peer:', peer.id, error)

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
          console.error('[ws:queues] error unsubscribing on error:', err)
        }
      }
      context.subscriptions.clear()
      peerContexts.delete(peer)
    }
  },
})
