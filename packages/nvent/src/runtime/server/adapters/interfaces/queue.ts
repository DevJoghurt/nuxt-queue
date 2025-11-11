/**
 * Queue Adapter Interface
 *
 * Handles job queue operations only (enqueue, retrieve, manage)
 * Does NOT handle event storage, state, or logging - those are separate concerns
 */

export interface QueueAdapter {
  /**
   * Initialize the queue adapter
   */
  init(): Promise<void>

  /**
   * Add a job to the queue
   * @returns Job ID
   */
  enqueue(queueName: string, job: JobInput): Promise<string>

  /**
   * Schedule a job (delayed or recurring)
   * @returns Job ID
   */
  schedule(queueName: string, job: JobInput, opts?: ScheduleOptions): Promise<string>

  /**
   * Get a specific job by ID
   */
  getJob(queueName: string, id: string): Promise<Job | null>

  /**
   * Get multiple jobs with optional filtering
   */
  getJobs(queueName: string, query?: JobsQuery): Promise<Job[]>

  /**
   * Subscribe to queue events
   * @returns Unsubscribe function
   */
  on(queueName: string, event: QueueEvent, callback: (payload: any) => void): () => void

  /**
   * Check if queue is paused
   */
  isPaused(queueName: string): Promise<boolean>

  /**
   * Get job counts by state
   */
  getJobCounts(queueName: string): Promise<JobCounts>

  /**
   * Pause the queue
   */
  pause(queueName: string): Promise<void>

  /**
   * Resume the queue
   */
  resume(queueName: string): Promise<void>

  /**
   * Register a worker handler for processing jobs
   * This is called by the worker registration system
   */
  registerWorker(
    queueName: string,
    jobName: string,
    handler: WorkerHandler,
    opts?: WorkerOptions,
  ): void

  /**
   * Start processing waiting jobs for a queue
   * Should be called after all handlers are registered
   */
  startProcessingQueue?(queueName: string): void

  /**
   * Close/cleanup the adapter
   */
  close(): Promise<void>
}

// Supporting types

export interface JobInput {
  name: string
  data: any
  opts?: JobOptions
}

export interface JobOptions {
  jobId?: string // Optional deterministic job ID for idempotency
  attempts?: number
  backoff?: {
    type: 'exponential' | 'fixed'
    delay: number
  }
  delay?: number
  priority?: number
  timeout?: number
  removeOnComplete?: boolean | number
  removeOnFail?: boolean | number
}

export interface Job {
  id: string
  name: string
  data: any
  returnvalue?: any
  failedReason?: string
  state: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'paused'
  timestamp?: number
  processedOn?: number
  finishedOn?: number
  attemptsMade?: number
  progress?: number
}

export interface JobsQuery {
  state?: JobState[]
  limit?: number
  offset?: number
}

export type JobState = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'paused'

export interface ScheduleOptions {
  delay?: number
  cron?: string
  repeat?: {
    pattern?: string
    limit?: number
  }
}

export interface JobCounts {
  active: number
  completed: number
  failed: number
  delayed: number
  waiting: number
  paused: number
}

export type QueueEvent = 'waiting' | 'active' | 'progress' | 'completed' | 'failed' | 'delayed' | 'paused' | 'stalled'

// Worker types

export interface WorkerHandler {
  (payload: any, ctx: WorkerContext): Promise<any>
}

export interface WorkerContext {
  jobId: string
  queueName: string
  [key: string]: any
}

export interface WorkerOptions {
  concurrency?: number
  autorun?: boolean
}
