import type { ModuleOptions, QueueModuleConfig } from './types'
import defu from 'defu'

/**
<<<<<<< HEAD
 * Merge and normalize module options with defaults (v0.4.1).
 * Applies connection fallback: adapter-specific connections override connections.redis/postgres.
 */
export function normalizeModuleOptions(options: ModuleOptions): Required<ModuleOptions> {
  // Default shared connections
  const defaultConnections = {
    redis: {
      host: '127.0.0.1',
      port: 6379,
    },
    postgres: {
      connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/nuxt_queue',
    },
    rabbitmq: {
      host: 'localhost',
      port: 5672,
    },
    kafka: {
      brokers: ['localhost:9092'],
    },
    file: {
      dataDir: '.data',
    },
  }

  // Base defaults for all adapters
  const defaults: Required<ModuleOptions> = {
    dir: 'queues',
    ui: true,
    debug: {},
    connections: defaultConnections,
    queue: {
      adapter: 'file',
      prefix: 'nq',
      defaultJobOptions: {},
      worker: {
        concurrency: 2,
        autorun: true,
        pollingIntervalMs: 1000,
      },
    },
    stream: {
      adapter: 'memory',
      prefix: 'nq',
    },
    store: {
      adapter: 'file',
      prefix: 'nq',
      state: {
        autoScope: 'always',
        cleanup: {
          strategy: 'never',
          ttlMs: 3600000, // 1 hour
        },
      },
      eventTTL: 604800, // 7 days
      metadataTTL: 2592000, // 30 days
    },
  }

  // Merge user options with defaults
  const normalized = defu(options, defaults) as Required<ModuleOptions>

  // Apply connection fallback for each adapter
  applyConnectionFallback(normalized)

  return normalized
}

/**
 * Apply connection fallback logic:
 * If an adapter doesn't specify a connection, use the shared connection from connections.*
 */
function applyConnectionFallback(config: Required<ModuleOptions>): void {
  // Queue adapter
  if (!config.queue.redis && config.connections.redis) {
    config.queue.redis = config.connections.redis
  }
  if (!config.queue.postgres && config.connections.postgres) {
    config.queue.postgres = config.connections.postgres
  }
  if (!config.queue.file && config.connections.file) {
    // Apply connections.file with subdirectory for queue
    config.queue.file = {
      dataDir: `${config.connections.file.dataDir}/queue`,
    }
  }

  // Stream adapter
  if (!config.stream.redis && config.connections.redis) {
    config.stream.redis = config.connections.redis
  }
  if (!config.stream.rabbitmq && config.connections.rabbitmq) {
    config.stream.rabbitmq = config.connections.rabbitmq
  }
  if (!config.stream.kafka && config.connections.kafka) {
    config.stream.kafka = config.connections.kafka
  }

  // Store adapter
  if (!config.store.redis && config.connections.redis) {
    config.store.redis = config.connections.redis
  }
  if (!config.store.postgres && config.connections.postgres) {
    config.store.postgres = config.connections.postgres
  }
  if (!config.store.file && config.connections.file) {
    // Apply connections.file with subdirectory for store
    config.store.file = {
      dataDir: `${config.connections.file.dataDir}/store`,
    }
  }
}

/**
 * Convert normalized module options to runtime config format (v0.4.1).
 */
export function toRuntimeConfig(normalizedOptions: Required<ModuleOptions>): QueueModuleConfig {
  return {
    debug: normalizedOptions.debug,
    workers: [],
    registry: undefined,
    rootDir: undefined,
    queue: normalizedOptions.queue as Required<typeof normalizedOptions.queue>,
    stream: normalizedOptions.stream as Required<typeof normalizedOptions.stream>,
    store: normalizedOptions.store as Required<typeof normalizedOptions.store>,
    connections: normalizedOptions.connections as Required<typeof normalizedOptions.connections>,
=======
 * Merge and normalize module options with defaults.
 * Handles the 'store' shortcut by expanding it to state, eventStore, and queue configs.
 */
export function normalizeModuleOptions(options: ModuleOptions): Required<Omit<ModuleOptions, 'store'>> {
  // Start with base defaults
  const defaults: Required<Omit<ModuleOptions, 'store'>> = {
    dir: 'queues',
    ui: true,
    debug: {},
    queue: {
      adapter: 'redis',
      redis: {
        host: '127.0.0.1',
        port: 6379,
      },
      defaultConfig: {
        // Queue options
        prefix: 'nq',
        defaultJobOptions: {},
        // Worker options
        worker: {
          concurrency: 2,
          autorun: true,
        },
      },
    },
    state: {
      adapter: 'redis',
      namespace: 'nq',
      autoScope: 'always',
      cleanup: {
        strategy: 'never',
      },
      redis: {
        host: '127.0.0.1',
        port: 6379,
      },
    },
    eventStore: {
      adapter: 'memory',
      options: {
        file: {
          dir: '.data/nq-events',
          ext: '.ndjson',
          pollMs: 1000,
        },
      },
      retention: {
        eventTTL: 604800, // 7 days
        metadataTTL: 2592000, // 30 days
      },
    },
  }

  // If 'store' shortcut is provided, expand it
  if (options.store) {
    const storeConfig = expandStoreShortcut(options.store)

    // Merge store expansion with explicit configs (explicit takes precedence)
    return defu(options, storeConfig, defaults) as Required<Omit<ModuleOptions, 'store'>>
  }

  // No shortcut, just merge with defaults
  return defu(options, defaults) as Required<Omit<ModuleOptions, 'store'>>
}

/**
 * Expand the 'store' shortcut to full configuration.
 * This allows users to set store: 'redis' and get all redis configs set up.
 */
function expandStoreShortcut(store: ModuleOptions['store']): Partial<Omit<ModuleOptions, 'store'>> {
  if (!store) return {}

  const storeAdapter = store.adapter

  if (storeAdapter === 'redis') {
    const redisConfig = store.redis || {
      host: '127.0.0.1',
      port: 6379,
    }

    return {
      queue: {
        adapter: 'redis',
        redis: redisConfig,
        defaultConfig: {},
      },
      state: {
        adapter: 'redis',
        namespace: 'nq',
        autoScope: 'always',
        cleanup: { strategy: 'never' },
        redis: redisConfig,
      },
      eventStore: {
        adapter: 'redis',
        redis: redisConfig,
      },
    }
  }

  if (storeAdapter === 'postgres') {
    const postgresConfig = store.postgres || {
      connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/nuxt_queue',
    }

    return {
      queue: {
        adapter: 'postgres',
        postgres: postgresConfig,
        defaultConfig: {},
      },
      state: {
        adapter: 'postgres',
        postgres: postgresConfig,
      },
      eventStore: {
        adapter: 'postgres',
        postgres: postgresConfig,
      },
    }
  }

  return {}
}

/**
 * Convert normalized module options to runtime config format.
 */
export function toRuntimeConfig(normalizedOptions: Required<Omit<ModuleOptions, 'store'>>): QueueModuleConfig {
  return {
    debug: normalizedOptions.debug,
    workers: [],
    queue: normalizedOptions.queue as Required<typeof normalizedOptions.queue>,
    state: normalizedOptions.state as Required<typeof normalizedOptions.state>,
    eventStore: normalizedOptions.eventStore as Required<typeof normalizedOptions.eventStore>,
>>>>>>> 227da8b (refactoring)
  }
}

/**
 * Get Redis connection config for nitro storage.
<<<<<<< HEAD
 * Uses shared connections.redis as primary source.
 */
export function getRedisStorageConfig(normalizedOptions: Required<ModuleOptions>) {
  const redisConfig = normalizedOptions.connections.redis
=======
 * Prefers queue.redis, falls back to state.redis.
 */
export function getRedisStorageConfig(normalizedOptions: Required<Omit<ModuleOptions, 'store'>>) {
  const redisConfig = normalizedOptions.queue.redis || normalizedOptions.state.redis
>>>>>>> 227da8b (refactoring)

  if (!redisConfig) {
    return {
      host: '127.0.0.1',
      port: 6379,
    }
  }

  return {
    host: redisConfig.host,
    port: redisConfig.port,
    username: redisConfig.username,
    password: redisConfig.password,
    db: redisConfig.db,
  }
}

export type { ModuleOptions, QueueModuleConfig } from './types'
