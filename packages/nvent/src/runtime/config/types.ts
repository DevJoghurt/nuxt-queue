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
   */
  redis?: RedisConfig

  /**
   * Postgres connection (overrides connections.postgres if specified)
   */
  postgres?: PostgresConfig

  /**
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
 * Webhooks configuration
 */
export interface WebhooksConfig {
  /**
   * Base URL for webhook endpoints
   * Auto-detected from Nitro context in development
   * Set explicitly for production or to override auto-detection
   * @default Auto-detected from NUXT_PUBLIC_SITE_URL, NITRO_URL, or dev server (http://localhost:3000 fallback)
   */
  baseUrl?: string
}

/**
 * Flow configuration
 */
export interface FlowConfig {
  /**
   * Stall detection configuration
   * Detects and marks flows that have been running without activity for too long
   */
  stallDetection?: {
    /**
     * Enable stall detection
     * @default true
     */
    enabled?: boolean

    /**
     * Time in milliseconds after which a running flow without activity is considered stalled
     * @default 1800000 (30 minutes)
     */
    stallTimeout?: number

    /**
     * Interval in milliseconds for periodic stall checks
     * @default 900000 (15 minutes)
     */
    checkInterval?: number

    /**
     * Enable periodic background checks
     * Set to false to use only lazy detection (when flows are queried)
     * @default true
     */
    enablePeriodicCheck?: boolean
  }
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
   */
  redis?: RedisConfig

  /**
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
   */
  dir?: string

  /**
   * Enable dev UI
   * @default true in development
   */
  ui?: boolean

  /**
   * Debug configuration
   */
  debug?: Record<string, any>

  /**
   * Queue adapter configuration (job execution)
   */
  queue?: QueueConfig

  /**
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
   * Flow-specific configuration
   * @since v0.4.1
   */
  flow?: FlowConfig

  /**
   * Webhooks configuration
   * @since v0.5.0
   */
  webhooks?: WebhooksConfig

  /**
   * Shared connection configurations
   * Used as fallback if adapters don't specify their own connections
   * @since v0.4.1
   */
  connections?: ConnectionsConfig
}

/**
 * Runtime config shape for nvent module (v0.4.1+)
 */
export interface ModuleConfig {
  debug?: Record<string, any>
  queue: Required<QueueConfig>
  stream: Required<StreamConfig>
  store: Required<StoreConfig>
  flow: Required<FlowConfig>
  webhooks: Required<WebhooksConfig>
  connections: Required<ConnectionsConfig>
  rootDir?: string
}
