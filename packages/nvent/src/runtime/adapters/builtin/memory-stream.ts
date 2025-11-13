/**
 * Memory Stream Adapter
 *
 * In-memory pub/sub implementation for development
 * - Uses EventEmitter pattern
 * - No external dependencies
 * - Single instance only
 * - Data lost on restart
 */

import type {
  StreamAdapter,
  StreamEvent,
  SubscribeOptions,
  SubscriptionHandle,
} from '../interfaces/stream'

export class MemoryStreamAdapter implements StreamAdapter {
  private subscriptions = new Map<string, Map<string, (event: StreamEvent) => void | Promise<void>>>()
  private subscriptionCounter = 0

  async init(): Promise<void> {
    // Nothing to initialize for in-memory
  }

  async publish(topic: string, event: StreamEvent): Promise<void> {
    const topicSubscriptions = this.subscriptions.get(topic)

    if (!topicSubscriptions || topicSubscriptions.size === 0) {
      // No subscribers, event is lost (as expected for pub/sub)
      return
    }

    // Add timestamp if not present
    const eventWithTs = {
      ...event,
      timestamp: event.timestamp || Date.now(),
    }

    // Call all subscribers
    const promises: Array<void | Promise<void>> = []
    Array.from(topicSubscriptions.values()).forEach((handler) => {
      promises.push(handler(eventWithTs))
    })

    // Wait for all handlers (supports async handlers)
    await Promise.all(promises)
  }

  async subscribe(
    topic: string,
    handler: (event: StreamEvent) => void | Promise<void>,
    _opts?: SubscribeOptions,
  ): Promise<SubscriptionHandle> {
    // Create subscription ID
    const subscriptionId = `sub-${++this.subscriptionCounter}`

    // Get or create topic subscriptions
    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, new Map())
    }

    const topicSubscriptions = this.subscriptions.get(topic)!
    topicSubscriptions.set(subscriptionId, handler)

    // Return subscription handle
    return {
      id: subscriptionId,
      topic,
      unsubscribe: async () => {
        await this.unsubscribe({ id: subscriptionId, topic, unsubscribe: async () => {} })
      },
    }
  }

  async unsubscribe(handle: SubscriptionHandle): Promise<void> {
    const topicSubscriptions = this.subscriptions.get(handle.topic)

    if (topicSubscriptions) {
      topicSubscriptions.delete(handle.id)

      // Clean up empty topic
      if (topicSubscriptions.size === 0) {
        this.subscriptions.delete(handle.topic)
      }
    }
  }

  async listTopics(): Promise<string[]> {
    return Array.from(this.subscriptions.keys())
  }

  async getSubscriptionCount(topic: string): Promise<number> {
    const topicSubscriptions = this.subscriptions.get(topic)
    return topicSubscriptions ? topicSubscriptions.size : 0
  }

  async shutdown(): Promise<void> {
    this.subscriptions.clear()
  }
}
