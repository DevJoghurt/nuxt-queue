/**
 * Adapter Access Utilities
 *
 * Provides composable-style access to the adapter architecture:
 * - QueueAdapter: Job queue operations
 * - StreamAdapter: Cross-instance pub/sub messaging
 * - StoreAdapter: Storage (events, documents, KV, indices)
 * - StateAdapter: Scoped key-value state storage (backed by StoreAdapter KV)
 *
 */
import { useRuntimeConfig } from '#imports'
import type { QueueAdapter } from '../../adapters/interfaces/queue'
import type { StreamAdapter } from '../../adapters/interfaces/stream'
import type { StoreAdapter } from '../../adapters/interfaces/store'
import type { AdapterSet } from '../../adapters/factory'

// Global adapter set (initialized by plugin)
declare global {
  var __nq_adapters: AdapterSet | undefined
}

/**
 * Set the global adapter set (called by plugin during initialization)
 */
export function setAdapters(adapters: AdapterSet): void {
  globalThis.__nq_adapters = adapters
}

/**
 * Get all adapters (internal use)
 */
export function getAdapters(): AdapterSet {
  if (!globalThis.__nq_adapters) {
    throw new Error('[nvent] Adapters not initialized. Make sure the nvent plugin is loaded.')
  }
  return globalThis.__nq_adapters
}

/**
 * Access QueueAdapter for job queue operations
 *
 * @example
 * const queue = useQueueAdapter()
 * await queue.enqueue('my-queue', { name: 'job', data: {...} })
 */
export function useQueueAdapter(): QueueAdapter {
  return getAdapters().queue
}

/**
 * Access StreamAdapter for cross-instance pub/sub
 *
 * @example
 * const stream = useStreamAdapter()
 * await stream.subscribe('store:append:*', (event) => {
 *   console.log('Remote update:', event)
 * })
 */
export function useStreamAdapter(): StreamAdapter {
  return getAdapters().stream
}

/**
 * Access StoreAdapter for storage operations
 *
 * @example
 * const store = useStoreAdapter()
 * await store.append('nq:flow:abc-123', { type: 'step.completed', data: {...} })
 * const events = await store.read('nq:flow:abc-123')
 */
export function useStoreAdapter(): StoreAdapter {
  return getAdapters().store
}

/**
 * State provider interface for flow state management
 */
export interface StateAdapter {
  get<T = any>(key: string): Promise<T | null>
  set<T = any>(key: string, value: T, opts?: { ttl?: number }): Promise<void>
  delete(key: string): Promise<void>
  clear(pattern: string): Promise<number>
  increment?: (key: string, by?: number) => Promise<number>
}

/**
 * Access StateAdapter for scoped key-value state storage
 *
 * State is backed by StoreAdapter's KV store with automatic namespacing.
 * Used by worker context (ctx.state) for flow-scoped state management.
 *
 * @example
 * const state = useStateAdapter()
 * await state.set('lastEmail', { to: 'user@example.com' })
 * const value = await state.get('lastEmail')
 */
export function useStateAdapter(): StateAdapter {
  const store = useStoreAdapter()

  // Get namespace from runtime config (lazy import to avoid circular dependencies)
  let namespace = 'nq'
  try {
    const rc: any = useRuntimeConfig()
    namespace = rc?.nvent?.state?.namespace || 'nq'
  }
  catch {
    // Fallback to default namespace if config not available
  }

  return {
    async get<T = any>(key: string): Promise<T | null> {
      return store.kv.get<T>(`${namespace}:${key}`)
    },
    async set<T = any>(key: string, value: T, opts?: { ttl?: number }): Promise<void> {
      await store.kv.set(`${namespace}:${key}`, value, opts?.ttl)
    },
    async delete(key: string): Promise<void> {
      await store.kv.delete(`${namespace}:${key}`)
    },
    async clear(pattern: string): Promise<number> {
      if (!store.kv.clear) {
        throw new Error('Store adapter does not support clear operation')
      }
      return store.kv.clear(`${namespace}:${pattern}`)
    },
    increment: store.kv.increment
      ? async (key: string, by: number = 1): Promise<number> => {
        if (!store.kv.increment) {
          throw new Error('Store adapter does not support increment operation')
        }
        return store.kv.increment(`${namespace}:${key}`, by)
      }
      : undefined,
  }
}
