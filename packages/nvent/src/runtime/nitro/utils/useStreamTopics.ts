/**
 * Stream topic naming utilities
 *
 * Provides standardized topic patterns for StreamAdapter pub/sub
 * Used for real-time UI updates via WebSocket/SSE
 *
 * Architecture:
 * 1. Store Subjects - Persistent storage keys (StoreAdapter)
 * 2. Stream Topics - Pub/sub channels (StreamAdapter)
 * 3. Wiring - Bridges store events to stream topics
 */

/**
 * Store subjects for persistent event streams and indexes
 * These are used with StoreAdapter (append/read operations)
 */
const StoreSubjects = {
  /**
   * Flow run event stream
   * Pattern: nq:flow:{runId}
   * Contains: All events for a specific flow run
   */
  flowRun: (runId: string) => `nq:flow:${runId}`,

  /**
   * Flow run index (sorted set)
   * Pattern: nq:flows:{flowName}
   * Contains: List of run IDs for a flow, sorted by timestamp
   */
  flowRunIndex: (flowName: string) => `nq:flows:${flowName}`,

  /**
   * Flow index (sorted set)
   * Pattern: nq:flows
   * Contains: Flow metadata and statistics
   */
  flowIndex: () => `nq:flows`,

  /**
   * Trigger event stream
   * Pattern: nq:trigger:{triggerName}
   * Contains: All events for a specific trigger
   */
  triggerStream: (triggerName: string) => `nq:trigger:${triggerName}`,

  /**
   * Trigger index (sorted set)
   * Pattern: nq:triggers
   * Contains: Trigger metadata, subscriptions, and statistics
   */
  triggerIndex: () => `nq:triggers`,
} as const

/**
 * Stream topics for real-time pub/sub
 * These are used with StreamAdapter (publish/subscribe operations)
 */
const StreamTopics = {
  /**
   * Flow events for a specific run
   * Pattern: stream:flow:events:{runId}
   * Published: When flow events occur (StreamWiring)
   * Subscribed: By WebSocket clients watching a specific flow run
   */
  flowEvents: (runId: string) => `stream:flow:events:${runId}`,

  /**
   * Flow statistics updates
   * Pattern: stream:flow:stats
   * Published: When flow stats change (StreamWiring)
   * Subscribed: By WebSocket clients watching flow overview
   */
  flowStats: () => `stream:flow:stats`,

  /**
   * Trigger events for a specific trigger
   * Pattern: stream:trigger:events:{triggerName}
   * Published: When trigger events occur (StreamWiring)
   * Subscribed: By WebSocket clients watching a specific trigger
   */
  triggerEvents: (triggerName: string) => `stream:trigger:events:${triggerName}`,

  /**
   * Trigger statistics updates
   * Pattern: stream:trigger:stats
   * Published: When trigger stats change (StreamWiring)
   * Subscribed: By WebSocket clients watching trigger overview
   */
  triggerStats: () => `stream:trigger:stats`,
} as const

export function useStreamTopics() {
  return {
    StoreSubjects,
    StreamTopics,
    // Legacy aliases for backward compatibility (deprecated)
    SubjectPatterns: StoreSubjects,
  }
}
