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
  }
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
}

export type NuxtQueueLogger = {
  debug?: (...args: any[]) => any
  info?: (...args: any[]) => any
  warn?: (...args: any[]) => any
  error?: (...args: any[]) => any
}
