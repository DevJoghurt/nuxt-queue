import { getStreamStoreFactory } from '../streamStore/streamStoreFactory'
import type { EventReadOptions, EventSubscription } from '../streamStore/types'
import type { EventRecord } from '../../types'

export function useStreamStore() {
  const factory = getStreamStoreFactory()

  async function read(stream: string, opts?: EventReadOptions): Promise<EventRecord[]> {
    return await factory.adapter.read(stream, opts)
  }

  async function indexAdd(key: string, id: string, score: number): Promise<void> {
    if (!factory.adapter.indexAdd) {
      throw new Error('Current adapter does not support indexAdd')
    }
    return await factory.adapter.indexAdd(key, id, score)
  }

  async function indexRead(key: string, opts?: { offset?: number, limit?: number }) {
    if (!factory.adapter.indexRead) {
      throw new Error('Current adapter does not support indexRead')
    }
    return await factory.adapter.indexRead(key, opts)
  }

  function names() {
    return factory.names
  }

  function subscribe(stream: string, handler: (e: EventRecord) => void): () => void {
    if (process.env.NQ_DEBUG_EVENTS === '1') {
      console.log('[use-stream-store] subscribing to', { stream })
    }
    let sub: EventSubscription | null = null
    let active = true
    ;(async () => {
      try {
        sub = await factory.adapter.subscribe(stream, (e) => {
          if (process.env.NQ_DEBUG_EVENTS === '1') {
            console.log('[use-stream-store] event received', { stream, id: e?.id, type: e?.type })
          }
          handler(e)
        })
        if (process.env.NQ_DEBUG_EVENTS === '1') {
          console.log('[use-stream-store] subscription active', { stream })
        }
      }
      catch (err) {
        if (process.env.NQ_DEBUG_EVENTS === '1') {
          console.error('[use-stream-store] subscription error', { stream, err })
        }
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
    indexRead,
    // subscribe to canonical stream events via the adapter (Store Bus)
    subscribe,
    // expose adapter if advanced usage is needed
    adapter: factory.adapter,
  }
}
