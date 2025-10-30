import { getStreamStoreFactory } from '../streamStore/streamStoreFactory'
import { getProjectionStreamNames } from '../streamStore/streamNames'
import type { EventReadOptions, EventSubscription } from '../streamStore/types'
import type { EventRecord } from '../events/eventBus'

export function useStreamStore() {
  const factory = getStreamStoreFactory()
  const proj = getProjectionStreamNames()
  // Subscribe directly via the underlying adapter (Store Bus)

  async function read(stream: string, opts?: EventReadOptions): Promise<EventRecord[]> {
    return await factory.adapter.read(stream, opts)
  }

  function names() {
    return factory.names
  }

  function projectionNames() {
    return proj
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
            console.log('[use-stream-store] event received', { stream, id: e?.id, kind: e?.kind })
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
    projectionNames,
    // read from canonical streams
    read,
    // subscribe to canonical stream events via the adapter (Store Bus)
    subscribe,
    // expose adapter if advanced usage is needed
    adapter: factory.adapter,
  }
}
