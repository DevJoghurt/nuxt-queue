/**
 * Redis connection configuration
 */
export interface RedisConfig {
  host?: string
  port?: number
  username?: string
  password?: string
  db?: number
  url?: string
}

/**
 * PostgreSQL connection configuration
 */
export interface PostgresConfig {
  connectionString?: string
  host?: string
  port?: number
  database?: string
  user?: string
  password?: string
}

/**
 * Queue provider configuration
 */
export interface QueueConfig {
  /**
   * Queue backend adapter: 'redis' (BullMQ) or 'postgres' (PGBoss)
   */
  adapter?: 'redis' | 'postgres'

  /**
   * Redis connection config (when using BullMQ)
   */
  redis?: RedisConfig

  /**
   * Postgres connection config (when using PGBoss)
   */
  postgres?: PostgresConfig

  /**
   * Default configuration for queues and workers.
   * Combines both queue and worker options for convenience.
   */
  defaultConfig?: {
    // Queue options
    prefix?: string
    defaultJobOptions?: {
      attempts?: number
      backoff?: number | { type: 'fixed' | 'exponential', delay: number }
      delay?: number
      priority?: number
      timeout?: number
      lifo?: boolean
      removeOnComplete?: boolean | number
      removeOnFail?: boolean | number
    }
    limiter?: {
      max?: number
      duration?: number
      groupKey?: string
    }

    // Worker options (nested)
    worker?: {
      concurrency?: number
      lockDurationMs?: number
      maxStalledCount?: number
      drainDelayMs?: number
      autorun?: boolean
      pollingIntervalMs?: number
    }
  }
}

/**
 * State provider configuration
 */
export interface StateConfig {
  adapter?: 'redis' | 'postgres'
  namespace?: string
  autoScope?: 'always' | 'flow' | 'never'
  cleanup?: {
    strategy?: 'never' | 'immediate' | 'ttl' | 'on-complete'
    ttlMs?: number
  }
  redis?: RedisConfig
  postgres?: PostgresConfig
}

/**
 * Event store configuration
 */
export interface EventStoreConfig {
  adapter?: 'redis' | 'postgres' | 'memory' | 'file'
  streams?: any
  options?: {
    file?: {
      dir?: string
      ext?: string
      pollMs?: number
    }
  }
  redis?: RedisConfig
  postgres?: PostgresConfig
}

/**
 * Store shortcut - sets all backends to the same storage
 */
export interface StoreShortcut {
  /**
   * Storage backend adapter to use for everything
   */
  adapter: 'redis' | 'postgres'

  /**
   * Redis config (used when adapter is 'redis')
   */
  redis?: RedisConfig

  /**
   * Postgres config (used when adapter is 'postgres')
   */
  postgres?: PostgresConfig
}

/**
 * Module options for nuxt-queue
 */
export interface ModuleOptions {
  /**
   * Directory to scan for queue workers
   */
  dir?: string

  /**
   * Enable dev UI
   */
  ui?: boolean

  /**
   * Debug configuration
   */
  debug?: Record<string, any>

  /**
   * Shortcut to configure all backends at once.
   * Setting this will configure queue, state, and eventStore to use the same backend.
   * Individual configs can still override this.
   */
  store?: StoreShortcut

  /**
   * Queue provider configuration (BullMQ/PGBoss)
   */
  queue?: QueueConfig

  /**
   * State provider configuration
   */
  state?: StateConfig

  /**
   * Event store configuration
   */
  eventStore?: EventStoreConfig
}

/**
 * Runtime config shape for queue module
 */
export interface QueueModuleConfig {
  debug?: Record<string, any>
  workers: any[]
  registry?: any
  queue: Required<QueueConfig>
  state: Required<StateConfig>
  eventStore: Required<EventStoreConfig>
  rootDir?: string
}
