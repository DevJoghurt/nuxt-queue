import { getEventStoreFactory } from '../events/eventStoreFactory'
import type { EventReadOptions, EventSubscription } from '../events/types'
import type { EventRecord } from '../types'
import { useServerLogger } from '#imports'

const logger = useServerLogger('event-store')

export function useEventStore() {
  const factory = getEventStoreFactory()

  async function read(stream: string, opts?: EventReadOptions): Promise<EventRecord[]> {
    return await factory.adapter.read(stream, opts)
  }

  async function indexAdd(key: string, id: string, score: number, metadata?: Record<string, any>): Promise<void> {
    if (!factory.adapter.indexAdd) {
      throw new Error('Current adapter does not support indexAdd')
    }
    return await factory.adapter.indexAdd(key, id, score, metadata)
  }

  async function indexGet(key: string, id: string) {
    if (!factory.adapter.indexGet) {
      throw new Error('Current adapter does not support indexGet')
    }
    return await factory.adapter.indexGet(key, id)
  }

  async function indexUpdate(key: string, id: string, metadata: Record<string, any>): Promise<boolean> {
    if (!factory.adapter.indexUpdate) {
      throw new Error('Current adapter does not support indexUpdate')
    }
    return await factory.adapter.indexUpdate(key, id, metadata)
  }

  async function indexUpdateWithRetry(key: string, id: string, metadata: Record<string, any>, maxRetries?: number): Promise<void> {
    if (!factory.adapter.indexUpdateWithRetry) {
      throw new Error('Current adapter does not support indexUpdateWithRetry')
    }
    return await factory.adapter.indexUpdateWithRetry(key, id, metadata, maxRetries)
  }

  async function indexIncrement(key: string, id: string, field: string, increment?: number): Promise<number> {
    if (!factory.adapter.indexIncrement) {
      throw new Error('Current adapter does not support indexIncrement')
    }
    return await factory.adapter.indexIncrement(key, id, field, increment)
  }

  async function indexRead(key: string, opts?: { offset?: number, limit?: number }) {
    if (!factory.adapter.indexRead) {
      throw new Error('Current adapter does not support indexRead')
    }
    return await factory.adapter.indexRead(key, opts)
  }

  async function deleteStream(subject: string): Promise<void> {
    if (!factory.adapter.deleteStream) {
      throw new Error('Current adapter does not support deleteStream')
    }
    return await factory.adapter.deleteStream(subject)
  }

  async function deleteByPattern(pattern: string): Promise<number> {
    if (!factory.adapter.deleteByPattern) {
      throw new Error('Current adapter does not support deleteByPattern')
    }
    return await factory.adapter.deleteByPattern(pattern)
  }

  async function deleteIndex(key: string): Promise<void> {
    if (!factory.adapter.deleteIndex) {
      throw new Error('Current adapter does not support deleteIndex')
    }
    return await factory.adapter.deleteIndex(key)
  }

  function names() {
    return factory.names
  }

  function subscribe(stream: string, handler: (e: EventRecord) => void): () => void {
    logger.debug('Subscribing to stream', { stream })
    let sub: EventSubscription | null = null
    let active = true
    ;(async () => {
      try {
        sub = await factory.adapter.subscribe(stream, (e) => {
          logger.debug('Event received', { stream, id: e?.id, type: e?.type })
          handler(e)
        })
        logger.debug('Subscription active', { stream })
      }
      catch (err) {
        logger.error('Subscription error', { stream, error: err })
      }
      if (!active && sub) {
        try {
          sub.unsubscribe()
        }
        catch {
          // ignore
        }
      }
    })()
    return () => {
      active = false
      if (sub) {
        try {
          sub.unsubscribe()
        }
        catch {
          // ignore
        }
        sub = null
      }
    }
  }

  return {
    // names
    names,
    // read from canonical streams
    read,
    // sorted set index operations
    indexAdd,
    indexGet,
    indexUpdate,
    indexUpdateWithRetry,
    indexIncrement,
    indexRead,
    // deletion operations
    deleteStream,
    deleteByPattern,
    deleteIndex,
    // subscribe to canonical stream events via the adapter (Store Bus)
    subscribe,
    // expose adapter if advanced usage is needed
    adapter: factory.adapter,
  }
}
