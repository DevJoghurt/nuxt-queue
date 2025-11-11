import type IORedis from 'ioredis'
import { useNventLogger } from '#imports'

/**
 * Gateway pattern for Redis Pub/Sub
 * Maintains a single 'message' listener and routes to channel-specific handlers
 */
export class RedisPubSubGateway {
  private channelSubscribers = new Map<string, Set<(messageId: string) => void>>()
  private initialized = false
  private logger = useNventLogger('redis-pubsub-gateway')

  constructor(private subscriber: IORedis) {}

  private initialize() {
    if (this.initialized) return
    this.initialized = true

    // Single message handler for all channels
    this.subscriber.on('message', (channel: string, messageId: string) => {
      const handlers = this.channelSubscribers.get(channel)
      if (!handlers || handlers.size === 0) return

      // Call all handlers for this channel
      for (const handler of handlers) {
        try {
          handler(messageId)
        }
        catch (err) {
          if (process.env.NQ_DEBUG_EVENTS === '1') {
            this.logger.error('[redis-pubsub-gateway] Handler error:', err)
          }
        }
      }
    })
  }

  /**
   * Subscribe to a channel with a handler
   * Returns unsubscribe function
   */
  async subscribe(channel: string, handler: (messageId: string) => void): Promise<() => void> {
    this.initialize()

    // Register handler
    if (!this.channelSubscribers.has(channel)) {
      this.channelSubscribers.set(channel, new Set())
      // Subscribe to Redis channel if this is the first subscriber
      await this.subscriber.subscribe(channel)

      if (process.env.NQ_DEBUG_EVENTS === '1') {
        this.logger.info('[redis-pubsub-gateway] Subscribed to channel:', channel)
      }
    }
    this.channelSubscribers.get(channel)!.add(handler)

    // Return unsubscribe function
    return () => {
      const handlers = this.channelSubscribers.get(channel)
      if (handlers) {
        handlers.delete(handler)

        // If no more handlers for this channel, unsubscribe from Redis
        if (handlers.size === 0) {
          this.channelSubscribers.delete(channel)
          this.subscriber.unsubscribe(channel).catch(() => {
            // ignore
          })

          if (process.env.NQ_DEBUG_EVENTS === '1') {
            this.logger.info('[redis-pubsub-gateway] Unsubscribed from channel:', channel)
          }
        }
      }
    }
  }

  /**
   * Get subscriber count for a channel (for debugging)
   */
  getSubscriberCount(channel: string): number {
    return this.channelSubscribers.get(channel)?.size ?? 0
  }

  /**
   * Get total subscriber count across all channels
   */
  getTotalSubscriberCount(): number {
    let count = 0
    for (const handlers of this.channelSubscribers.values()) {
      count += handlers.size
    }
    return count
  }

  /**
   * Cleanup all subscriptions
   */
  async cleanup() {
    const channels = Array.from(this.channelSubscribers.keys())
    this.channelSubscribers.clear()

    if (channels.length > 0) {
      await this.subscriber.unsubscribe(...channels).catch(() => {
        // ignore
      })
    }
  }
}
