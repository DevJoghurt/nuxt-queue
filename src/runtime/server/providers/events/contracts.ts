export interface EventRecord<T = any> {
  id: string
  stream: string
  ts: string
  kind: string
  subject?: string
  data: T
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

export interface EventSubscription { unsubscribe(): void }

export interface EventStoreProvider {
  append<T = any>(stream: string, e: Omit<EventRecord<T>, 'id' | 'ts' | 'stream'>): Promise<EventRecord<T>>
  read(stream: string, opts?: EventReadOptions): Promise<EventRecord[]>
  subscribe(stream: string, onEvent: (e: EventRecord) => void): Promise<EventSubscription>
  close(): Promise<void>
}
