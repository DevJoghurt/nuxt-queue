import type { WorkerOptions as BullmqWorkerOptions } from 'bullmq'
import type z from 'zod'
import type { JobSchemaArray, JobSchema } from './schema'

export type Jobs = z.infer<typeof JobSchemaArray>
export type Job = z.infer<typeof JobSchema>

export type WorkerOptions = Omit<BullmqWorkerOptions, 'connection' | 'useWorkerThreads'>

export type WorkerConfig = Record<string, WorkerOptions>

export type JobCounts = {
  active: number
  completed: number
  failed: number
  delayed: number
  waiting: number
  paused: number
}

export type QueueData = {
  name: string
  active: boolean
  jobs: JobCounts
  worker: number
}
