import type { ModuleOptions, ModuleConfig } from './types'
import defu from 'defu'

/**
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
export function toRuntimeConfig(normalizedOptions: Required<ModuleOptions>): ModuleConfig {
  return {
    debug: normalizedOptions.debug,
    workers: [],
    registry: undefined,
    rootDir: undefined,
    queue: normalizedOptions.queue as Required<typeof normalizedOptions.queue>,
    stream: normalizedOptions.stream as Required<typeof normalizedOptions.stream>,
    store: normalizedOptions.store as Required<typeof normalizedOptions.store>,
    connections: normalizedOptions.connections as Required<typeof normalizedOptions.connections>,
  }
}

/**
 * Get Redis connection config for nitro storage.
 * Uses shared connections.redis as primary source.
 */
export function getRedisStorageConfig(normalizedOptions: Required<ModuleOptions>) {
  const redisConfig = normalizedOptions.connections.redis

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

export type { ModuleOptions, ModuleConfig } from './types'
