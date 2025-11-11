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
<<<<<<< HEAD
  ssl?: boolean | object
}

/**
 * RabbitMQ connection configuration
 */
export interface RabbitMQConfig {
  url?: string
  host?: string
  port?: number
  username?: string
  password?: string
  vhost?: string
}

/**
 * Kafka connection configuration
 */
export interface KafkaConfig {
  brokers?: string[]
  clientId?: string
  groupId?: string
}

/**
 * File storage configuration
 */
export interface FileConfig {
  /**
   * Base directory for file storage
   * @default '.data'
   */
  dataDir?: string
}

/**
 * Shared connection configurations (v0.4.1)
 * Provides fallback connections for all adapters
 */
export interface ConnectionsConfig {
  /**
   * Shared Redis connection - used by adapters that specify 'redis' but don't provide connection details
   */
  redis?: RedisConfig

  /**
   * Shared Postgres connection - used by adapters that specify 'postgres' but don't provide connection details
   */
  postgres?: PostgresConfig

  /**
   * Shared RabbitMQ connection - used by stream adapter when 'rabbitmq' is specified
   */
  rabbitmq?: RabbitMQConfig

  /**
   * Shared Kafka connection - used by stream adapter when 'kafka' is specified
   */
  kafka?: KafkaConfig

  /**
   * Shared file storage configuration - used by file adapters
   */
  file?: FileConfig
}

/**
 * Worker configuration
 */
export interface WorkerConfig {
  /**
   * Number of concurrent jobs to process
   * @default 2
   */
  concurrency?: number

  /**
   * Lock duration for jobs in milliseconds
   */
  lockDurationMs?: number

  /**
   * Maximum number of times a job can be stalled before failing
   */
  maxStalledCount?: number

  /**
   * Delay before draining the queue on shutdown
   */
  drainDelayMs?: number

  /**
   * Automatically start workers
   * @default true
   */
  autorun?: boolean

  /**
   * Polling interval for file adapter (milliseconds)
   * @default 1000
   */
  pollingIntervalMs?: number
}

/**
 * Queue adapter configuration (v0.4.1)
 */
export interface QueueConfig {
  /**
   * Queue backend adapter
   * @default 'file'
   */
  adapter?: 'memory' | 'file' | 'redis' | 'postgres'

  /**
   * Redis connection (overrides connections.redis if specified)
=======
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
>>>>>>> 227da8b (refactoring)
   */
  redis?: RedisConfig

  /**
<<<<<<< HEAD
   * Postgres connection (overrides connections.postgres if specified)
=======
   * Postgres connection config (when using PGBoss)
>>>>>>> 227da8b (refactoring)
   */
  postgres?: PostgresConfig

  /**
<<<<<<< HEAD
   * File storage configuration (overrides connections.file if specified)
   */
  file?: FileConfig

  /**
   * Queue-specific options (BullMQ/PGBoss configuration)
   */
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

  /**
   * Worker configuration
   */
  worker?: WorkerConfig
}

/**
 * Stream adapter configuration (v0.4.1)
 * Cross-instance pub/sub messaging
 */
export interface StreamConfig {
  /**
   * Stream adapter
   * @default 'memory'
   */
  adapter?: 'memory' | 'redis' | 'rabbitmq' | 'kafka'

  /**
   * Redis connection (overrides connections.redis if specified)
   */
  redis?: RedisConfig

  /**
   * Postgres connection (overrides connections.postgres if specified)
   */
  postgres?: PostgresConfig

  /**
   * RabbitMQ connection (overrides connections.rabbitmq if specified)
   */
  rabbitmq?: RabbitMQConfig

  /**
   * Kafka connection (overrides connections.kafka if specified)
   */
  kafka?: KafkaConfig

  /**
   * Stream-specific options
   */
  prefix?: string
  retryAttempts?: number
  retryDelay?: number
}

/**
 * State management configuration
 */
export interface StateManagementConfig {
  /**
   * Automatic scope/flow ID assignment for state operations
   * - 'always': Always create a new flow ID (recommended for most cases)
   * - 'flow': Only use flow ID if provided in context
   * - 'never': Never scope state to flow IDs
   * @default 'always'
   */
  autoScope?: 'always' | 'flow' | 'never'

  /**
   * State cleanup strategy
   */
  cleanup?: {
    /**
     * Cleanup strategy
     * - 'never': State persists indefinitely
     * - 'immediate': Cleanup after each step (not recommended)
     * - 'on-complete': Cleanup when flow completes (recommended)
     * - 'ttl': Automatic expiration via TTL
     * @default 'never'
     */
    strategy?: 'never' | 'immediate' | 'on-complete' | 'ttl'
    /**
     * TTL in milliseconds for 'ttl' strategy
     * @default 3600000 (1 hour)
     */
    ttlMs?: number
  }
}

/**
 * Store adapter configuration (v0.4.1)
 * Three-tier storage: events (NDJSON), documents (JSON), KV (JSON), indices (JSON)
 * Replaces both state and eventStore configs from v0.4.0
 */
export interface StoreConfig {
  /**
   * Store adapter
   * @default 'file'
   */
  adapter?: 'memory' | 'file' | 'redis' | 'postgres'

  /**
   * Redis connection (overrides connections.redis if specified)
=======
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
  /**
   * Retention settings for event lifecycle tracking
   */
  retention?: {
    /**
     * How long to keep event stream data (in seconds)
     * @default 604800 (7 days)
     */
    eventTTL?: number
    /**
     * How long to keep flow metadata after completion/failure (in seconds)
     * @default 2592000 (30 days)
     */
    metadataTTL?: number
  }
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
>>>>>>> 227da8b (refactoring)
   */
  redis?: RedisConfig

  /**
<<<<<<< HEAD
   * Postgres connection (overrides connections.postgres if specified)
   */
  postgres?: PostgresConfig

  /**
   * File storage configuration (overrides connections.file if specified)
   */
  file?: FileConfig

  /**
   * Key prefix/namespace for all store operations
   * @default 'nq'
   */
  prefix?: string

  /**
   * State management configuration (KV store behavior)
   */
  state?: StateManagementConfig

  /**
   * Event stream TTL in seconds
   * @default 604800 (7 days)
   */
  eventTTL?: number

  /**
   * Metadata document TTL in seconds
   * @default 2592000 (30 days)
   */
  metadataTTL?: number

  /**
   * KV store TTL in seconds
   */
  kvTTL?: number

  /**
   * Index TTL in seconds
   */
  indexTTL?: number

  /**
   * Enable compression for stored data
   */
  compression?: boolean
}

/**
 * Module options for nvent (v0.4.1+)
 */
export interface ModuleOptions {
  /**
   * Directory to scan for function definitions
   * @default 'server/functions'
=======
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
>>>>>>> 227da8b (refactoring)
   */
  dir?: string

  /**
   * Enable dev UI
<<<<<<< HEAD
   * @default true in development
=======
>>>>>>> 227da8b (refactoring)
   */
  ui?: boolean

  /**
   * Debug configuration
   */
  debug?: Record<string, any>

  /**
<<<<<<< HEAD
   * Queue adapter configuration (job execution)
=======
   * Shortcut to configure all backends at once.
   * Setting this will configure queue, state, and eventStore to use the same backend.
   * Individual configs can still override this.
   */
  store?: StoreShortcut

  /**
   * Queue provider configuration (BullMQ/PGBoss)
>>>>>>> 227da8b (refactoring)
   */
  queue?: QueueConfig

  /**
<<<<<<< HEAD
   * Stream adapter configuration (pub/sub messaging)
   * @since v0.4.1
   */
  stream?: StreamConfig

  /**
   * Store adapter configuration (persistence)
   * Three-tier storage: events, documents, KV, indices
   * @since v0.4.1
   */
  store?: StoreConfig

  /**
   * Shared connection configurations
   * Used as fallback if adapters don't specify their own connections
   * @since v0.4.1
   */
  connections?: ConnectionsConfig
}

/**
 * Runtime config shape for nvent module (v0.4.1+)
=======
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
>>>>>>> 227da8b (refactoring)
 */
export interface QueueModuleConfig {
  debug?: Record<string, any>
  workers: any[]
  registry?: any
  queue: Required<QueueConfig>
<<<<<<< HEAD
  stream: Required<StreamConfig>
  store: Required<StoreConfig>
  connections: Required<ConnectionsConfig>
=======
  state: Required<StateConfig>
  eventStore: Required<EventStoreConfig>
>>>>>>> 227da8b (refactoring)
  rootDir?: string
}
