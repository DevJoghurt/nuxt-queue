/**
 * Adapter Access Utilities
 *
 * Provides composable-style access to the new three-adapter architecture:
 * - QueueAdapter: Job queue operations
 * - StreamAdapter: Cross-instance pub/sub messaging
 * - StoreAdapter: Storage (events, documents, KV, indices)
 *
 * These replace the old EventStoreAdapter pattern.
 */

import type { QueueAdapter } from '../adapters/interfaces/queue'
import type { StreamAdapter } from '../adapters/interfaces/stream'
import type { StoreAdapter } from '../adapters/interfaces/store'
import type { AdapterSet } from '../adapters/factory'

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
 * Replaces the old useEventStore() utility.
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
 * @deprecated Use useStoreAdapter() instead
 * Legacy compatibility wrapper
 */
export function useStore() {
  return useStoreAdapter()
}
