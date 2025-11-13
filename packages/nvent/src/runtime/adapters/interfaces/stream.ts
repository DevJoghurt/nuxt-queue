/**
 * Stream Adapter Interface
 *
 * Handles pub/sub messaging for cross-instance communication
 * Replaces the pub/sub functionality from EventStoreAdapter.subscribe()
 */

export interface StreamAdapter {
  /**
   * Initialize the stream adapter
   */
  init(): Promise<void>

  /**
   * Publish an event to a topic
   */
  publish(topic: string, event: StreamEvent): Promise<void>

  /**
   * Subscribe to a topic
   * @returns Subscription handle for unsubscribing
   */
  subscribe(
    topic: string,
    handler: (event: StreamEvent) => void | Promise<void>,
    opts?: SubscribeOptions
  ): Promise<SubscriptionHandle>

  /**
   * Unsubscribe from a topic
   */
  unsubscribe(handle: SubscriptionHandle): Promise<void>

  /**
   * List all active topics
   */
  listTopics(): Promise<string[]>

  /**
   * Get number of subscribers for a topic
   */
  getSubscriptionCount(topic: string): Promise<number>

  /**
   * Shutdown the adapter and cleanup resources
   */
  shutdown(): Promise<void>
}

// Supporting types

export interface StreamEvent {
  type: string
  data: any
  metadata?: Record<string, any>
  timestamp?: number
}

export interface SubscribeOptions {
  /**
   * Consumer group for load balancing (if supported)
   */
  group?: string

  /**
   * Filter events by type pattern
   */
  filter?: string | RegExp

  /**
   * Starting position (if supported by adapter)
   */
  fromBeginning?: boolean
}

export interface SubscriptionHandle {
  id: string
  topic: string
  unsubscribe: () => Promise<void>
}
