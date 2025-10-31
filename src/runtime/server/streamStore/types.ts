import type { EventRecord } from '../../types'

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
}

export interface IndexReadOptions {
  offset?: number
  limit?: number
}

// v0.4 minimal adapter interface - runId-based streams
export interface StreamAdapter {
  append(subject: string, e: Omit<EventRecord, 'id' | 'ts'>): Promise<EventRecord>
  read(subject: string, opts?: EventReadOptions): Promise<EventRecord[]>
  subscribe(subject: string, onEvent: (e: EventRecord) => void): Promise<EventSubscription>

  // Index operations for sorted lists (e.g., flow runs by flow name)
  indexAdd?(key: string, id: string, score: number): Promise<void>
  indexRead?(key: string, opts?: IndexReadOptions): Promise<IndexEntry[]>

  close(): Promise<void>
}
