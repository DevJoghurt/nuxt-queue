import { JobSchemaArray } from './schema'
import z from 'zod'

export type Jobs = z.infer<typeof JobSchemaArray>

export type JobCounts = { 
  active: number
  completed: number
  failed: number
  delayed: number
  waiting: number
  paused: number

}
S
export type QueueData = {
  id: string
  active: boolean
  jobs: JobCounts
}