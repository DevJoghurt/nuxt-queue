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
export interface QueueJobDefaults {
  attempts?: number
  backoff?: number | { type: 'fixed' | 'exponential', delay: number }
  delay?: number
  priority?: number
  timeout?: number
  lifo?: boolean
  removeOnComplete?: boolean | number
  removeOnFail?: boolean | number
  repeat?: {
    cron?: string
    every?: number
    limit?: number
    tz?: string
  }
}

// Logical queue configuration (not connection). Generic to work across providers.
export interface QueueConfig {
  name: string
  defaultJobOptions?: QueueJobDefaults
  prefix?: string
}

// Execution/runtime options for the worker processor
export interface WorkerConfig {
  concurrency?: number
  lockDurationMs?: number
  maxStalledCount?: number
  drainDelayMs?: number
  autorun?: boolean
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
