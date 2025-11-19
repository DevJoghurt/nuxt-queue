export type LayerInfo = {
  rootDir: string
  serverDir: string
}

export type WorkerEntry = {
  id: string
  kind: 'ts' | 'py'
  filePath: string
  absPath: string
  exportName?: string
  queue: {
    name: string
    defaultJobOptions?: any
    prefix?: string
    limiter?: any
  }
  worker?: { concurrency?: number, lockDurationMs?: number, maxStalledCount?: number, drainDelayMs?: number, autorun?: boolean, pollingIntervalMs?: number }
  // Optional per-worker runtype override for TS runner isolation (e.g., 'inprocess' | 'task')
  runtype?: 'inprocess' | 'task'
  flow?: {
    names: string[]
    role: 'entry' | 'step'
    step: string | string[]
    emits?: string[]
    subscribes?: string[]
    // v0.5: Trigger configuration
    triggers?: {
      subscribe: string[]
      mode?: 'auto' | 'manual'
    }
    awaitBefore?: AwaitConfig
    awaitAfter?: AwaitConfig
  }
}

/**
 * Await configuration (v0.5)
 */
export type AwaitConfig = {
  type: 'webhook' | 'event' | 'schedule' | 'time'
  path?: string
  method?: string
  event?: string
  filterKey?: string
  cron?: string
  nextAfterHours?: number
  timezone?: string
  delay?: number
  timeout?: number
  timeoutAction?: 'fail' | 'continue' | 'retry'
}

/**
 * Trigger definition (v0.5)
 * Registered programmatically via registerTrigger()
 */
export type TriggerEntry = {
  name: string
  type: 'event' | 'webhook' | 'schedule' | 'manual'
  scope: 'flow' | 'run'
  displayName?: string
  description?: string
  source?: string

  // Optional validation hints (not enforced)
  expectedSubscribers?: string[]

  // Type-specific config
  webhook?: {
    path: string
    method?: string
    auth?: any
  }
  schedule?: {
    cron: string
    timezone?: string
    enabled?: boolean
  }

  // Metadata
  registeredAt: string
  registeredBy: 'code' | 'runtime'
}

/**
 * Trigger subscription (v0.5)
 * Runtime index of flow -> trigger subscriptions
 */
export type TriggerSubscription = {
  triggerName: string
  flowName: string
  mode: 'auto' | 'manual'
  source: 'config' | 'programmatic'
  registeredAt: string
}

export type FlowEntry = {
  step: string
  queue: string
  workerId: string
}

export type FlowStep = {
  queue: string
  workerId: string
  subscribes?: string[]
}

export type FlowsIndex = Record<string, {
  entry?: FlowEntry
  steps: Record<string, FlowStep>
}>

export type EventIndexEntry = {
  flowId: string
  step: string
  queue: string
  workerId: string
}

export type EventIndex = Record<string, Array<EventIndexEntry>>

export type FlowSource = {
  flow: NonNullable<WorkerEntry['flow']>
  queue: string
  id: string
}

export type ConfigMeta = {
  queueName?: string
  flow?: WorkerEntry['flow']
  runtype?: 'inprocess' | 'task'
  queue?: { name?: string, defaultJobOptions?: any, prefix?: string, limiter?: any }
  worker?: { concurrency?: number, lockDurationMs?: number, maxStalledCount?: number, drainDelayMs?: number, autorun?: boolean, pollingIntervalMs?: number }
  hasDefaultExport?: boolean
  hasHooks?: boolean
}

export type NuxtQueueLogger = {
  debug?: (...args: any[]) => any
  info?: (...args: any[]) => any
  warn?: (...args: any[]) => any
  error?: (...args: any[]) => any
}
