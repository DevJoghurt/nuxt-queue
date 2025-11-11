export type JobCounts = {
  active: number
  completed: number
  failed: number
  delayed: number
  waiting: number
  paused: number
}

export type QueueEvent = 'added' | 'waiting' | 'active' | 'progress' | 'completed' | 'failed' | 'paused' | 'resumed'

export interface JobInput {
  name: string
  data: any
  opts?: Record<string, any>
}

export interface Job {
  id: string
  name: string
  data: any
  state?: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'paused'
  returnvalue?: any
  failedReason?: string
  timestamp?: number
  processedOn?: number
  finishedOn?: number
}

export interface JobsQuery {
  state?: Array<Job['state']>
  limit?: number
  cursor?: string
}

export interface ScheduleOptions {
  delay?: number
  cron?: string
}

export interface QueueProvider {
  init(): Promise<void>
  enqueue(queue: string, job: JobInput): Promise<string>
  schedule(queue: string, job: JobInput, opts?: ScheduleOptions): Promise<string>
  getJob(queue: string, id: string): Promise<Job | null>
  getJobs(queue: string, q?: JobsQuery): Promise<Job[]>
  on(queue: string, event: QueueEvent, cb: (p: any) => void): () => void
  getJobCounts?(queue: string): Promise<Record<string, number>>
  isPaused?(queue: string): Promise<boolean>
  pause(queue: string): Promise<void>
  resume(queue: string): Promise<void>
  close(): Promise<void>
}
