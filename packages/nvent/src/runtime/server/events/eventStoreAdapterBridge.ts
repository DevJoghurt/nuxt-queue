/**
 * Bridge from new StoreAdapter to old EventStoreAdapter interface
 * Used by flow wiring which still expects the old interface
 */

import { useStoreAdapter } from '#imports'
import type { EventStoreAdapter } from './types'

export function createEventStoreAdapterBridge(): EventStoreAdapter {
  const store = useStoreAdapter()

  return {
    append: (subject, event) => store.append(subject, event),
    read: (subject, opts) => store.read(subject, opts),
    subscribe: async (subject, onEvent) => {
      if (!store.subscribe) {
        throw new Error('Current StoreAdapter does not support subscribe')
      }
      return await store.subscribe(subject, onEvent)
    },
    indexAdd: store.indexAdd,
    indexGet: store.indexGet,
    indexUpdate: store.indexUpdate,
    indexUpdateWithRetry: store.indexUpdateWithRetry,
    indexIncrement: store.indexIncrement,
    indexRead: store.indexRead,
    setMetadataTTL: undefined,
    cleanupCompletedFlows: undefined,
    deleteStream: undefined,
    deleteByPattern: undefined,
    deleteIndex: undefined,
    close: () => store.close(),
  }
}
