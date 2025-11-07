// Central worker config typings used by userland worker files.
// Keep this minimal and stable; extend as features solidify.

export type FlowRole = 'entry' | 'step'

export interface FlowConfig {
  /**
   * One or more flow names this step belongs to.
   * A single worker step can participate in multiple flows.
   */
  name: string | string[]
  /**
   * Role of this step in the flow.
   */
  role: FlowRole
  /**
   * Logical step name (used as job name and event kind on start).
   */
  step: string
  /**
   * Event kinds this step emits (e.g., `${step}.completed`).
   */
  emits?: string[]
  /**
   * Event kinds this step subscribes to; can be a single string or an array.
   * The compiler normalizes this to `string[]` under `subscribes`.
   */
  subscribes?: string | string[]
}

// Provider-agnostic job defaults applied when enqueuing jobs for this queue
// Options compatible with both BullMQ and PGBoss
export interface QueueJobDefaults {
  /**
   * Number of retry attempts for failed jobs.
   * BullMQ: attempts, PGBoss: retryLimit
   */
  attempts?: number
  /**
   * Backoff strategy for retries.
   * BullMQ: backoff, PGBoss: retryBackoff + exponentialBackoff
   */
  backoff?: number | { type: 'fixed' | 'exponential', delay: number }
  /**
   * Delay in milliseconds before the job is processed.
   * BullMQ: delay, PGBoss: startAfter
   */
  delay?: number
  /**
   * Job priority (higher number = higher priority).
   * BullMQ: priority, PGBoss: priority
   */
  priority?: number
  /**
   * Job timeout in milliseconds.
   * BullMQ: timeout, PGBoss: expireInSeconds (converted)
   */
  timeout?: number
  /**
   * Process jobs in LIFO (Last In First Out) order.
   * BullMQ: lifo, PGBoss: not supported
   */
  lifo?: boolean
  /**
   * Remove job from queue when completed.
   * BullMQ: removeOnComplete, PGBoss: deleteAfterSeconds
   */
  removeOnComplete?: boolean | number
  /**
   * Remove job from queue when failed.
   * BullMQ: removeOnFail, PGBoss: deleteAfterSeconds
   */
  removeOnFail?: boolean | number
  /**
   * Repeatable job configuration.
   * BullMQ: repeat, PGBoss: schedule pattern
   */
  repeat?: {
    cron?: string
    every?: number
    limit?: number
    tz?: string
  }
}

// Logical queue configuration (not connection). Generic to work across providers.
export interface QueueConfig {
  /**
   * Queue name. If not provided, the filename will be used.
   */
  name?: string
  /**
   * Default options for jobs enqueued to this queue.
   */
  defaultJobOptions?: QueueJobDefaults
  /**
   * Prefix for queue keys in Redis/storage.
   * BullMQ: prefix, PGBoss: schema
   */
  prefix?: string
  /**
   * Rate limiting configuration.
   * BullMQ: limiter, PGBoss: teamSize + teamConcurrency (partial)
   */
  limiter?: {
    /**
     * Maximum number of jobs to process in the duration window.
     */
    max?: number
    /**
     * Duration of the rate limit window in milliseconds.
     */
    duration?: number
    /**
     * Group key for rate limiting (optional).
     * BullMQ only: allows per-group rate limiting
     */
    groupKey?: string
  }
}

// Execution/runtime options for the worker processor
// Options compatible with both BullMQ and PGBoss
export interface WorkerConfig {
  /**
   * Number of jobs to process concurrently.
   * BullMQ: concurrency, PGBoss: teamSize
   */
  concurrency?: number
  /**
   * Lock duration in milliseconds.
   * BullMQ: lockDuration, PGBoss: newJobCheckInterval (similar concept)
   */
  lockDurationMs?: number
  /**
   * Maximum number of times a job can be stalled before being failed.
   * BullMQ: maxStalledCount, PGBoss: not directly supported
   */
  maxStalledCount?: number
  /**
   * Delay in milliseconds before processing jobs after queue is drained.
   * BullMQ: drainDelay, PGBoss: not directly supported
   */
  drainDelayMs?: number
  /**
   * Automatically run worker on startup.
   * BullMQ: autorun, PGBoss: workers start automatically
   */
  autorun?: boolean
  /**
   * Polling interval in milliseconds for checking new jobs.
   * PGBoss: newJobCheckInterval, BullMQ: uses blocking wait
   */
  pollingIntervalMs?: number
}

export interface QueueWorkerConfig {
  // Logical queue config. If omitted, filename will be used as queue name.
  queue?: QueueConfig
  // Flow metadata to participate in a flow (optional)
  flow?: FlowConfig
  // Per-worker execution options (optional)
  worker?: WorkerConfig
  // Room for future options (e.g., concurrency, retry policies) without breaking users
  // options?: WorkerOptionsLike
}

export type DefineQueueConfig = <T extends QueueWorkerConfig>(cfg: T) => T

export const defineQueueConfig: DefineQueueConfig = cfg => cfg

export default defineQueueConfig
