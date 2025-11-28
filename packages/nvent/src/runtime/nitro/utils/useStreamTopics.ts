import { useRuntimeConfig } from '#imports'

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
 *
 * All patterns use the configured prefix from nvent config (default: 'nvent')
 */

/**
 * Get store subjects for persistent event streams and indexes
 * These are used with StoreAdapter (append/read operations)
 * 
 * Naming Convention:
 * - Streams (event logs): singular + ID -> {prefix}:flow:run:{runId}, {prefix}:trigger:event:{triggerName}
 * - Indexes (sorted sets): plural -> {prefix}:flows, {prefix}:triggers
 * - KV stores: descriptive path -> {prefix}:scheduler:job:{id}
 */
function getStoreSubjects(prefix: string) {
  return {
    /**
     * Flow run event stream
     * Pattern: {prefix}:flow:run:{runId}
     * Type: Redis Stream (XADD/XRANGE)
     * Contains: All events for a specific flow run
     */
    flowRun: (runId: string) => `${prefix}:flow:run:${runId}`,

    /**
     * Flow runs index (sorted set)
     * Pattern: {prefix}:flow:runs:{flowName}
     * Type: Sorted Set + Hash metadata
     * Contains: List of run IDs for a flow, sorted by timestamp
     */
    flowRunIndex: (flowName: string) => `${prefix}:flow:runs:${flowName}`,

    /**
     * Flows index (sorted set)
     * Pattern: {prefix}:flows
     * Type: Sorted Set + Hash metadata
     * Contains: Flow metadata and statistics
     */
    flowIndex: () => `${prefix}:flows`,

    /**
     * Trigger event stream
     * Pattern: {prefix}:trigger:event:{triggerName}
     * Type: Redis Stream (XADD/XRANGE)
     * Contains: All events for a specific trigger
     */
    triggerStream: (triggerName: string) => `${prefix}:trigger:event:${triggerName}`,

    /**
     * Triggers index (sorted set)
     * Pattern: {prefix}:triggers
     * Type: Sorted Set + Hash metadata
     * Contains: Trigger metadata, subscriptions, and statistics
     */
    triggerIndex: () => `${prefix}:triggers`,

    /**
     * Scheduler job index
     * Pattern: {prefix}:scheduler:jobs
     * Type: Sorted Set + Hash metadata
     * Contains: Scheduled job metadata
     */
    schedulerJobs: () => `${prefix}:scheduler:jobs`,

    /**
     * Scheduler lock index
     * Pattern: {prefix}:scheduler:locks
     * Type: Sorted Set + Hash metadata
     * Contains: Distributed scheduler lock metadata
     */
    schedulerLocks: () => `${prefix}:scheduler:locks`,
  } as const
}

/**
 * Get stream topics for real-time pub/sub
 * These are used with StreamAdapter (publish/subscribe operations)
 *
 * Note: Returns the FULL topic name including prefix
 * Example: 'nvent:stream:flow:events:123'
 */
function getStreamTopics(prefix: string) {
  return {
    /**
     * Flow events for a specific run
     * Pattern: {prefix}:stream:flow:events:{runId}
     * Published: When flow events occur (StreamWiring)
     * Subscribed: By WebSocket clients watching a specific flow run
     */
    flowEvents: (runId: string) => `${prefix}:stream:flow:events:${runId}`,

    /**
     * Flow statistics updates
     * Pattern: {prefix}:stream:flow:stats
     * Published: When flow stats change (StreamWiring)
     * Subscribed: By WebSocket clients watching flow overview
     */
    flowStats: () => `${prefix}:stream:flow:stats`,

    /**
     * Trigger events for a specific trigger
     * Pattern: {prefix}:stream:trigger:events:{triggerName}
     * Published: When trigger events occur (StreamWiring)
     * Subscribed: By WebSocket clients watching a specific trigger
     */
    triggerEvents: (triggerName: string) => `${prefix}:stream:trigger:events:${triggerName}`,

    /**
     * Trigger statistics updates
     * Pattern: {prefix}:stream:trigger:stats
     * Published: When trigger stats change (StreamWiring)
     * Subscribed: By WebSocket clients watching trigger overview
     */
    triggerStats: () => `${prefix}:stream:trigger:stats`,
  } as const
}

export function useStreamTopics() {
  const config = useRuntimeConfig()
  const prefix = config.nvent.store?.prefix || 'nvent'

  return {
    StoreSubjects: getStoreSubjects(prefix),
    StreamTopics: getStreamTopics(prefix),
  }
}
