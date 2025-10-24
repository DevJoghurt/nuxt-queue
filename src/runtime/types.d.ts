import type { WorkerOptions as BullmqWorkerOptions } from 'bullmq'
import type z from 'zod'
import type colors from 'tailwindcss/colors'
import type { JobSchemaArray, JobSchema } from './schema'

type NeutralColor = 'slate' | 'gray' | 'zinc' | 'neutral' | 'stone'
export type Color = Exclude<keyof typeof colors, 'inherit' | 'current' | 'transparent' | 'black' | 'white' | NeutralColor> | NeutralColor

export type Jobs = z.infer<typeof JobSchemaArray>
export type Job = z.infer<typeof JobSchema>

export type WorkerOptions = Omit<BullmqWorkerOptions, 'connection' | 'useWorkerThreads'>

export type WorkerConfig = Record<string, WorkerOptions>

export type QueueData = {
  name: string
  origin: 'remote' | 'local'
  active: boolean
  jobs: JobCounts
  worker: number
}

// Declarations for worker authoring helpers available via auto-imports at runtime
// These declarations make TS happy in worker files and tests.
export declare function defineQueueWorker(processor: (...args: any[]) => any): any
export declare function defineQueueConfig(cfg: any): any
