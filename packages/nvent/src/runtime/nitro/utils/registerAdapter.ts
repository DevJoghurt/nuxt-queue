/**
 * Adapter Registration Utilities
 *
 * Used by external adapter modules to register their adapters with nvent
 */

import { useAdapterRegistry } from '../../adapters/registry'
import type { QueueAdapter } from '../../adapters/interfaces/queue'
import type { StreamAdapter } from '../../adapters/interfaces/stream'
import type { StoreAdapter } from '../../adapters/interfaces/store'

/**
 * Register a queue adapter
 *
 * Called by external adapter modules (e.g., @nvent/adapter-queue-redis)
 * to register their adapter implementation.
 *
 * @param name - Adapter name (e.g., 'redis', 'postgres', 'rabbitmq')
 * @param adapter - QueueAdapter implementation
 *
 * @example
 * import { registerQueueAdapter } from '#imports'
 * import { RedisQueueAdapter } from './adapter'
 *
 * const adapter = new RedisQueueAdapter({ connection })
 * registerQueueAdapter('redis', adapter)
 */
export function registerQueueAdapter(name: string, adapter: QueueAdapter): void {
  const registry = useAdapterRegistry()
  registry.registerQueue(name, adapter)
}

/**
 * Register a stream adapter
 *
 * Called by external adapter modules (e.g., @nvent/adapter-stream-redis)
 * to register their adapter implementation.
 *
 * @param name - Adapter name (e.g., 'redis', 'rabbitmq', 'kafka')
 * @param adapter - StreamAdapter implementation
 *
 * @example
 * import { registerStreamAdapter } from '#imports'
 * import { RedisStreamAdapter } from './adapter'
 *
 * const adapter = new RedisStreamAdapter({ connection })
 * registerStreamAdapter('redis', adapter)
 */
export function registerStreamAdapter(name: string, adapter: StreamAdapter): void {
  const registry = useAdapterRegistry()
  registry.registerStream(name, adapter)
}

/**
 * Register a store adapter
 *
 * Called by external adapter modules (e.g., @nvent/adapter-store-redis)
 * to register their adapter implementation.
 *
 * @param name - Adapter name (e.g., 'redis', 'postgres')
 * @param adapter - StoreAdapter implementation
 *
 * @example
 * import { registerStoreAdapter } from '#imports'
 * import { RedisStoreAdapter } from './adapter'
 *
 * const adapter = new RedisStoreAdapter({ connection })
 * registerStoreAdapter('redis', adapter)
 */
export function registerStoreAdapter(name: string, adapter: StoreAdapter): void {
  const registry = useAdapterRegistry()
  registry.registerStore(name, adapter)
}
