// Central worker config typings used by userland worker files.
// Keep this minimal and stable; extend as features solidify.

export type FlowRole = 'main' | 'step'

export interface FlowConfig {
  id: string
  role: FlowRole
  step: string
  emits?: string[]
  // Accept string or string[] at authoring time; compiler normalizes to string[]
  triggers?: string | string[]
}

export interface QueueWorkerConfig {
  // Explicit queue name (optional). If omitted, module export `queue` or filename will be used.
  queue?: string
  // Flow metadata to participate in a flow (optional)
  flow?: FlowConfig
  // Room for future options (e.g., concurrency, retry policies) without breaking users
  // options?: WorkerOptionsLike
}

export type DefineQueueConfig = <T extends QueueWorkerConfig>(cfg: T) => T

export const defineQueueConfig: DefineQueueConfig = cfg => cfg

export default defineQueueConfig
