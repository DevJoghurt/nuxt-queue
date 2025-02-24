import type {
  WorkerOptions as BullmqWorkerOptions,
  QueueOptions as BullmqQueueOptions } from 'bullmq'

export type WorkerRuntype = 'sandboxed' | 'in-process'

export type WorkerOptions = Omit<BullmqWorkerOptions, 'connection'>

export type WorkerConfig = Record<string, WorkerOptions>

export type RegisteredWorker = {
  name: string
  processor: string
  file: string
  cwd: string
  runtype: WorkerRuntype
  options: WorkerOptions
}

export type RedisOptions = {
  host?: string
  port?: number
  password?: string
  username?: string
}

export type QueueOptions = {
  // if the worker runs locally or remote
  origin: 'local' | 'remote'
  options?: BullmqQueueOptions
  env?: Record<string, string>
}

export interface ModuleOptions {
  dir?: string
  runtimeDir?: string
  ui?: boolean
  redis?: RedisOptions
  queues?: Record<string, QueueOptions>
}
