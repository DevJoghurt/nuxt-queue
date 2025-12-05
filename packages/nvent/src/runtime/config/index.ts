import type { ModuleOptions, ModuleConfig } from './types'
import defu from 'defu'

/**
 * Merge and normalize module options with defaults.
 * Applies connection fallback: adapter-specific connections override connections.redis/postgres.
 * Only includes connection defaults for adapters that are actually used.
 */
export function normalizeModuleOptions(options: ModuleOptions): Required<ModuleOptions> {
  // Base defaults for all adapters
  const defaults: Required<ModuleOptions> = {
    dir: 'functions',
    ui: true,
    debug: {},
    connections: {},
    queue: {
      adapter: 'file',
      prefix: 'nvent',
      schema: 'nvent_queue',
      defaultJobOptions: {},
      worker: {
        concurrency: 2,
        autorun: true,
        pollingIntervalMs: 1000,
      },
    },
    stream: {
      adapter: 'memory',
      prefix: 'nvent',
    },
    store: {
      adapter: 'file',
      prefix: 'nvent',
      schema: 'nvent_store',
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
    flow: {
      stallDetection: {
        enabled: true,
        stallTimeout: 30 * 60 * 1000, // 30 minutes
        checkInterval: 15 * 60 * 1000, // 15 minutes
        enablePeriodicCheck: true,
      },
      awaitDefaults: {
        webhookTimeout: 24 * 60 * 60 * 1000, // 24 hours
        eventTimeout: 24 * 60 * 60 * 1000, // 24 hours
        timeTimeout: undefined, // No default timeout for time awaits
        scheduleTimeout: undefined, // No default timeout for schedule awaits
        timeoutAction: 'fail',
      },
      stepTimeout: 5 * 60 * 1000, // 5 minutes default step execution timeout
    },
    webhooks: {
      // baseUrl will be determined at runtime from Nitro context
      // Users can override via NUXT_PUBLIC_SITE_URL or explicit config
      baseUrl: process.env.NUXT_PUBLIC_SITE_URL || undefined,
    },
  }

  // Merge user options with defaults
  const normalized = defu(options, defaults) as Required<ModuleOptions>

  // Determine which connection types are needed based on adapter selections
  const neededConnections = new Set<string>()

  // Check queue adapter
  const queueAdapter = normalized.queue.adapter
  if (queueAdapter === 'redis') {
    neededConnections.add('redis')
  }
  else if (queueAdapter === 'postgres') {
    neededConnections.add('postgres')
  }
  else if (queueAdapter === 'file') {
    neededConnections.add('file')
  }

  // Check stream adapter
  const streamAdapter = normalized.stream.adapter
  if (streamAdapter === 'redis') {
    neededConnections.add('redis')
  }
  else if (streamAdapter === 'rabbitmq') {
    neededConnections.add('rabbitmq')
  }
  else if (streamAdapter === 'kafka') {
    neededConnections.add('kafka')
  }

  // Check store adapter
  const storeAdapter = normalized.store.adapter
  if (storeAdapter === 'redis') {
    neededConnections.add('redis')
  }
  else if (storeAdapter === 'postgres') {
    neededConnections.add('postgres')
  }
  else if (storeAdapter === 'file') {
    neededConnections.add('file')
  }

  // Only add default connections for adapters that are actually used
  if (!normalized.connections) {
    normalized.connections = {}
  }

  if (neededConnections.has('redis') && !normalized.connections.redis) {
    normalized.connections.redis = {
      host: '127.0.0.1',
      port: 6379,
    }
  }

  if (neededConnections.has('postgres') && !normalized.connections.postgres) {
    normalized.connections.postgres = {
      connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/nvent',
    }
  }

  if (neededConnections.has('rabbitmq') && !normalized.connections.rabbitmq) {
    normalized.connections.rabbitmq = {
      host: 'localhost',
      port: 5672,
    }
  }

  if (neededConnections.has('kafka') && !normalized.connections.kafka) {
    normalized.connections.kafka = {
      brokers: ['localhost:9092'],
    }
  }

  if (neededConnections.has('file') && !normalized.connections.file) {
    normalized.connections.file = {
      dataDir: '.data',
    }
  }

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
 * Convert normalized module options to runtime config format.
 */
export function toRuntimeConfig(normalizedOptions: Required<ModuleOptions>): ModuleConfig {
  return {
    debug: normalizedOptions.debug,
    rootDir: undefined,
    queue: normalizedOptions.queue as Required<typeof normalizedOptions.queue>,
    stream: normalizedOptions.stream as Required<typeof normalizedOptions.stream>,
    store: normalizedOptions.store as Required<typeof normalizedOptions.store>,
    connections: normalizedOptions.connections as Required<typeof normalizedOptions.connections>,
    flow: normalizedOptions.flow as Required<typeof normalizedOptions.flow>,
    webhooks: normalizedOptions.webhooks as Required<typeof normalizedOptions.webhooks>,
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
