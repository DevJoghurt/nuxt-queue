import { useRuntimeConfig } from '#imports'
import type { StoreAdapter } from '../adapters/interfaces/store'
import type { StateProvider } from './types'
import { useStoreAdapter } from '../utils/useAdapters'

/**
 * Get state provider (backed by StoreAdapter KV)
 * Provides scoped key-value storage for flow state
 */
export function getStateProvider(): StateProvider {
  const store = useStoreAdapter()
  const rc: any = useRuntimeConfig()
  const ns = rc?.queue?.state?.namespace || 'nq'

  return {
    async get<T = any>(key: string): Promise<T | null> {
      return store.kv.get<T>(`${ns}:${key}`)
    },
    async set<T = any>(key: string, value: T, opts?: { ttl?: number }): Promise<void> {
      await store.kv.set(`${ns}:${key}`, value, opts?.ttl)
    },
    async delete(key: string): Promise<void> {
      await store.kv.delete(`${ns}:${key}`)
    },
    async clear(pattern: string): Promise<number> {
      if (!store.kv.clear) {
        throw new Error('Store adapter does not support clear operation')
      }
      return store.kv.clear(`${ns}:${pattern}`)
    },
    increment: store.kv.increment
      ? async (key: string, by: number = 1): Promise<number> => {
        if (!store.kv.increment) {
          throw new Error('Store adapter does not support increment operation')
        }
        return store.kv.increment(`${ns}:${key}`, by)
      }
      : undefined,
  }
}

/**
 * Get the underlying store adapter
 * @deprecated Use useStoreAdapter() from utils/useAdapters instead
 */
export function getStoreAdapter(): StoreAdapter {
  return useStoreAdapter()
}

/**
 * Set the store adapter instance
 * @deprecated No longer needed - adapters are set globally via setAdapters()
 */
export function setStoreAdapter(_adapter: StoreAdapter) {
  // No-op: kept for backwards compatibility
  console.warn('[nvent] setStoreAdapter() is deprecated and no longer needed')
}

/**
 * @deprecated Use setStoreAdapter() instead
 */
export function setStateProvider(adapter: StoreAdapter) {
  setStoreAdapter(adapter)
}
