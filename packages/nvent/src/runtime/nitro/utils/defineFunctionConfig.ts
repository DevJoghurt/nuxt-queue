// Central worker config typings used by userland worker files.
// Keep this minimal and stable; extend as features solidify.

export type FlowRole = 'entry' | 'step'

/**
 * Trigger definition for inline trigger registration
 * Can be defined in function config alongside subscription
 */
export interface TriggerDefinition {
  /**
   * Unique trigger name (e.g., 'manual.approve-order')
   */
  name: string
  /**
   * Trigger type
   */
  type: 'event' | 'webhook' | 'schedule' | 'manual'
  /**
   * Trigger scope: 'flow' for entry triggers, 'await' for await patterns
   */
  scope?: 'flow' | 'await'
  /**
   * Human-readable display name
   */
  displayName?: string
  /**
   * Description of what this trigger does
   */
  description?: string
  /**
   * Expected flows that should subscribe to this trigger (for validation)
   */
  expectedSubscribers?: string[]
  /**
   * Webhook-specific configuration
   */
  webhook?: {
    /**
     * URL path for webhook (e.g., '/api/webhooks/stripe')
     */
    path: string
    /**
     * HTTP method
     */
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
    /**
     * Authentication configuration
     */
    auth?: any
  }
  /**
   * Schedule-specific configuration
   */
  schedule?: {
    /**
     * Cron expression (e.g., '0 9 * * *' for 9 AM daily)
     */
    cron: string
    /**
     * Timezone for cron expression
     */
    timezone?: string
    /**
     * Whether schedule is enabled
     */
    enabled?: boolean
  }
  /**
   * Additional configuration options
   */
  config?: Record<string, any>
}

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
  /**
   * Entry trigger configuration (v0.5)
   * Define and/or subscribe to triggers to start flow runs
   */
  triggers?: {
    /**
     * Define a new trigger inline (optional)
     * If provided, this trigger will be registered at build time
     */
    define?: TriggerDefinition
    /**
     * Array of trigger names to subscribe to
     * Can include the defined trigger or external triggers
     */
    subscribe: string[]
    /**
     * Trigger mode: 'auto' (immediate) or 'manual' (requires approval)
     */
    mode?: 'auto' | 'manual'
  }
  /**
   * Step execution timeout in milliseconds (v0.5.1)
   * Overrides global flow.stepTimeout and queue.defaultJobOptions.timeout for this specific step
   * 
   * @example 600000 // 10 minutes
   * @example 3600000 // 1 hour
   */
  stepTimeout?: number
  /**
   * Await pattern: Wait BEFORE step execution (v0.5)
   * Step won't execute until trigger fires
   */
  awaitBefore?: AwaitConfig
  /**
   * Await pattern: Wait AFTER step execution (v0.5)
   * Next steps won't trigger until trigger fires
   */
  awaitAfter?: AwaitConfig
}

/**
 * Await configuration (run-scoped triggers)
 *
 * Pauses flow execution until a specific condition is met. Can be used with:
 * - `awaitBefore`: Wait before step execution starts
 * - `awaitAfter`: Wait after step completes before triggering next steps
 *
 * Declared in config, no functions allowed (AST-parsed at build time)
 */
export interface AwaitConfig {
  /**
   * Type of trigger to wait for
   * - `webhook`: Wait for HTTP request to specific endpoint
   * - `event`: Wait for custom event with optional data matching
   * - `schedule`: Wait until specific cron schedule time
   * - `time`: Wait for fixed time delay
   */
  type: 'webhook' | 'event' | 'schedule' | 'time'

  /**
   * URL path for webhook trigger (supports template variables)
   *
   * Only used when `type: 'webhook'`
   *
   * Template variables available:
   * - `{runId}`: Current flow run ID
   * - `{stepId}`: Current step execution ID
   *
   * @example '/webhooks/approve/{runId}'
   * @example '/api/confirm/{stepId}'
   */
  path?: string

  /**
   * HTTP method for webhook endpoint
   *
   * Only used when `type: 'webhook'`
   *
   * @default 'POST'
   */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'

  /**
   * Event name to wait for
   *
   * Only used when `type: 'event'`
   *
   * @example 'payment.completed'
   * @example 'order.shipped'
   */
  event?: string

  /**
   * Key to match between event data and step output
   *
   * Only used when `type: 'event'`
   *
   * Matches incoming event data against step output data.
   * Supports nested paths using dot notation.
   *
   * @example 'orderId' - matches event.orderId === stepOutput.orderId
   * @example 'order.id' - matches event.order.id === stepOutput.order.id
   */
  filterKey?: string

  /**
   * Cron expression defining when to trigger (one-time schedule)
   *
   * Only used when `type: 'schedule'`
   *
   * Note: This is a one-time trigger, not recurring. The next occurrence
   * of the cron expression after step completion will trigger continuation.
   *
   * @example '0 9 * * *' - 9 AM daily (triggers at next 9 AM occurrence)
   * @example '0 0 * * MON' - Midnight every Monday
   */
  cron?: string

  /**
   * Timezone for cron expression evaluation
   *
   * Only used when `type: 'schedule'`
   *
   * @example 'America/New_York'
   * @example 'Europe/Berlin'
   * @default 'UTC'
   */
  timezone?: string

  /**
   * Fixed delay in milliseconds before continuation
   *
   * Only used when `type: 'time'`
   *
   * @example 60000 - 1 minute
   * @example 3600000 - 1 hour
   */
  delay?: number

  /**
   * Maximum wait time in milliseconds before timeout
   *
   * Applies to all trigger types. If the trigger doesn't fire within
   * this duration, the timeout action will be taken.
   *
   * @example 86400000 - 24 hours
   * @example 604800000 - 7 days
   */
  timeout?: number

  /**
   * Action to take when timeout is reached
   *
   * - `fail`: Mark step/flow as failed
   * - `continue`: Continue flow execution anyway
   * - `retry`: Retry waiting (reset timeout)
   *
   * @default 'fail'
   */
  timeoutAction?: 'fail' | 'continue' | 'retry'
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

export type DefineFunctionConfig = <T extends QueueWorkerConfig>(cfg: T) => T

export const defineFunctionConfig: DefineFunctionConfig = cfg => cfg

/**
 * Helper for defining trigger configurations inline
 * This is just a type helper, actual value is the same as defineFunctionConfig
 */
export type DefineTriggerConfig = <T extends TriggerDefinition>(cfg: T) => T

export const defineTriggerConfig: DefineTriggerConfig = cfg => cfg

export default defineFunctionConfig
