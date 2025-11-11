import type { EventRecord } from '../types'

// v0.4: Using runId-based routing

export interface PublishContext {
  queue?: string
  jobId?: string
  /** Flow run ID for flow events */
  flowId?: string
  /** Trigger ID for trigger events */
  triggerId?: string
}

export interface PublishPayload<T = any> {
  type: string
  runId: string
  flowName: string
  stepName?: string
  stepId?: string
  attempt?: number
  data?: T
}

export interface EventReadOptions {
  fromId?: string
  limit?: number
  direction?: 'forward' | 'backward'
}

export interface EventSubscription {
  unsubscribe(): void
}

export interface IndexEntry {
  id: string
  score: number
  metadata?: {
    status?: 'running' | 'completed' | 'failed'
    startedAt?: number
    completedAt?: number
    stepCount?: number
    completedSteps?: number
    emittedEvents?: string[]
    version?: number
  }
}

export interface IndexReadOptions {
  offset?: number
  limit?: number
}

// v0.4 minimal adapter interface - runId-based streams
export interface EventStoreAdapter {
  append(subject: string, e: Omit<EventRecord, 'id' | 'ts'>): Promise<EventRecord>
  read(subject: string, opts?: EventReadOptions): Promise<EventRecord[]>
  subscribe(subject: string, onEvent: (e: EventRecord) => void): Promise<EventSubscription>

  // Index operations for sorted lists (e.g., flow runs by flow name)
  indexAdd?(key: string, id: string, score: number, metadata?: Record<string, any>): Promise<void>
  indexGet?(key: string, id: string): Promise<IndexEntry | null>
  indexUpdate?(key: string, id: string, metadata: Record<string, any>): Promise<boolean>
  indexUpdateWithRetry?(key: string, id: string, metadata: Record<string, any>, maxRetries?: number): Promise<void>
  indexIncrement?(key: string, id: string, field: string, increment?: number): Promise<number>
  indexRead?(key: string, opts?: IndexReadOptions): Promise<IndexEntry[]>

  // Metadata TTL for lifecycle cleanup
  setMetadataTTL?(flowName: string, runId: string, ttlSeconds: number): Promise<void>
  cleanupCompletedFlows?(key: string, retentionSeconds: number): Promise<number>

  // Deletion operations
  /** Delete a specific stream/subject */
  deleteStream?(subject: string): Promise<void>
  /** Delete all streams matching a pattern (e.g., 'flow:*' or 'trigger:webhook-*') */
  deleteByPattern?(pattern: string): Promise<number>
  /** Delete an index key */
  deleteIndex?(key: string): Promise<void>

  close(): Promise<void>
}
