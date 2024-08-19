import type {
  WorkerOptions as BullmqWorkerOptions,
  QueueOptions as BullmqQueueOptions } from 'bullmq'

export type WorkerOptions = Omit<BullmqWorkerOptions, 'connection' | 'useWorkerThreads'>

export type WorkerConfig = Record<string, WorkerOptions>

export type RegisteredWorker = {
  id: string
  name: string
  script: string
  options: WorkerOptions
}

type QueueOptions = {
  // Queue processManager type, currently only pm2 is supported
  processManager: 'pm2'
  // if the worker runs local or remote
  origin: 'local' | 'remote'
  options?: BullmqQueueOptions
  env?: Record<string, string>
}

export interface ModuleOptions {
  dir: string
  runtimeDir: string
  redis: {
    host: string
    port: number
  }
  queues?: Record<string, QueueOptions>
}
