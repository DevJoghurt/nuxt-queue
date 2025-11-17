/**
 * Adapter Factory (v0.4.1)
 *
 * Creates adapters independently without dependencies
 * StoreAdapter is pure storage - streaming handled by wiring layer
 *
 * Now supports external adapters via the adapter registry.
 * External adapters registered via the nvent:registerAdapter hook take precedence.
 */

import type { QueueAdapter } from './interfaces/queue'
import type { StreamAdapter } from './interfaces/stream'
import type { StoreAdapter } from './interfaces/store'
import type { QueueConfig, StreamConfig, StoreConfig } from '../config/types'
import { useAdapterRegistry } from './registry'

import {
  MemoryQueueAdapter,
  MemoryStreamAdapter,
  MemoryStoreAdapter,
  FileQueueAdapter,
  FileStoreAdapter,
} from './builtin'

export interface AdapterSet {
  queue: QueueAdapter
  stream: StreamAdapter
  store: StoreAdapter
}

/**
 * Create a complete set of adapters (v0.4.1)
 * All adapters are independent - wiring layer handles coordination
 */
export async function createAdapters(config: {
  queue: QueueConfig
  stream: StreamConfig
  store: StoreConfig
}): Promise<AdapterSet> {
  // Create all adapters independently (order doesn't matter)
  const stream = await createStreamAdapter(config.stream)
  const store = await createStoreAdapter(config.store)
  const queue = await createQueueAdapter(config.queue)

  return { queue, stream, store }
}

async function createStreamAdapter(config: StreamConfig): Promise<StreamAdapter> {
  const type = config.adapter || 'memory'
  const registry = useAdapterRegistry()

  // Check if an external adapter is registered
  if (registry.hasStream(type)) {
    const adapter = registry.getStream(type)
    await adapter.init()
    return adapter
  }

  // Fall back to built-in adapters
  switch (type) {
    case 'memory': {
      // Memory adapter for single-instance or dev environments
      const adapter = new MemoryStreamAdapter()
      await adapter.init()
      return adapter
    }

    case 'redis':
      throw new Error('Redis stream adapter not registered. Install @nvent/adapter-stream-redis and add it to your nuxt.config modules.')

    case 'rabbitmq':
      throw new Error('RabbitMQ stream adapter not yet implemented')

    case 'kafka':
      throw new Error('Kafka stream adapter not yet implemented')

    default:
      throw new Error(`Unknown stream adapter type: ${type}`)
  }
}

async function createStoreAdapter(
  config: StoreConfig,
): Promise<StoreAdapter> {
  const type = config.adapter || 'file'
  const registry = useAdapterRegistry()

  // Check if an external adapter is registered
  if (registry.hasStore(type)) {
    const adapter = registry.getStore(type)
    // StoreAdapter doesn't have init() method, only close()
    return adapter
  }

  // Fall back to built-in adapters
  switch (type) {
    case 'memory': {
      // Memory adapter - pure in-memory storage
      return new MemoryStoreAdapter()
    }

    case 'file': {
      const dataDir = config.file?.dataDir || '.data/store'
      const adapter = new FileStoreAdapter({
        dataDir,
      })
      await adapter.init()
      return adapter
    }

    case 'redis':
      throw new Error('Redis store adapter not registered. Install @nvent/adapter-store-redis and add it to your nuxt.config modules.')

    case 'postgres':
      throw new Error('Postgres store adapter not yet implemented')

    default:
      throw new Error(`Unknown store adapter type: ${type}`)
  }
}

async function createQueueAdapter(config: QueueConfig): Promise<QueueAdapter> {
  const type = config.adapter || 'file'
  const registry = useAdapterRegistry()

  // Check if an external adapter is registered
  if (registry.hasQueue(type)) {
    const adapter = registry.getQueue(type)
    await adapter.init()
    return adapter
  }

  // Fall back to built-in adapters
  switch (type) {
    case 'memory': {
      const adapter = new MemoryQueueAdapter()
      await adapter.init()
      return adapter
    }

    case 'file': {
      const dataDir = config.file?.dataDir || '.data/queue'
      const adapter = new FileQueueAdapter({ dataDir })
      await adapter.init()
      return adapter
    }

    case 'redis':
      throw new Error('Redis queue adapter not registered. Install @nvent/adapter-queue-redis and add it to your nuxt.config modules.')

    case 'postgres':
      throw new Error('Postgres queue adapter (PGBoss) not yet implemented')

    default:
      throw new Error(`Unknown queue adapter type: ${type}`)
  }
}

/**
 * Shutdown all adapters gracefully
 */
export async function shutdownAdapters(adapters: AdapterSet): Promise<void> {
  await Promise.all([
    adapters.queue.close(),
    adapters.stream.shutdown(),
    adapters.store.close(),
  ])
}
