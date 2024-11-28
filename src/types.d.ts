import type {
  WorkerOptions as BullmqWorkerOptions,
  QueueOptions as BullmqQueueOptions } from 'bullmq'

export type WorkerOptions = Omit<BullmqWorkerOptions, 'connection' | 'useWorkerThreads'>

export type WorkerConfig = Record<string, WorkerOptions>

export type RegisteredWorker = {
  name: string
  script: string
  options: WorkerOptions
}

type QueueOptions = {
  // if the worker runs locally or remote
  origin: 'local' | 'remote'
  options?: BullmqQueueOptions
  env?: Record<string, string>
}

export interface ModuleOptions {
  dir: string
  runtimeDir: string
  ui: boolean
  redis: {
    host: string
    port: number
    password?: string
    username?: string
  }
  queues?: Record<string, QueueOptions>
}
