// Stream logical names similar to Motia's typed streams
export type LogicalStream = 'global' | 'queue' | 'job' | 'flow'

export interface PublishContext {
  queue?: string
  jobId?: string
  flowId?: string // aka traceId/correlation id
}

export interface PublishPayload<T = any> {
  kind: string
  subject?: string
  data?: T
  meta?: any
  correlationId?: string
  causationId?: string
}

// Local event contracts to avoid dependency on removed providers
export interface EventRecord<T = any> {
  id: string
  stream: string
  ts: string
  kind: string
  subject?: string
  data?: T
  meta?: any
  correlationId?: string
  causationId?: string
  v?: number
}

export interface EventReadOptions {
  fromId?: string
  limit?: number
  direction?: 'forward' | 'backward'
}

export interface EventSubscription {
  unsubscribe(): void
}

// Minimal adapter interface aligned with Motia's StreamAdapter concept
export interface StreamAdapter {
  append<T = any>(stream: string, e: Omit<EventRecord<T>, 'id' | 'ts' | 'stream'>): Promise<EventRecord<T>>
  read(stream: string, opts?: EventReadOptions): Promise<EventRecord[]>
  subscribe(stream: string, onEvent: (e: EventRecord) => void): Promise<EventSubscription>
  close(): Promise<void>
}
