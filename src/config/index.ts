import type { ModuleOptions, QueueModuleConfig } from './types'
import defu from 'defu'

/**
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
  }
}

/**
 * Get Redis connection config for nitro storage.
 * Prefers queue.redis, falls back to state.redis.
 */
export function getRedisStorageConfig(normalizedOptions: Required<Omit<ModuleOptions, 'store'>>) {
  const redisConfig = normalizedOptions.queue.redis || normalizedOptions.state.redis

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
