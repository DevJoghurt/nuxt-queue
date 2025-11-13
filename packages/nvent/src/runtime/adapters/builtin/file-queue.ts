/**
 * File Queue Adapter
 *
 * File-based queue implementation for development/small deployments
 * - Uses fastq for job processing (same as memory adapter)
 * - Persists jobs to file system
 * - Survives restarts
 * - Single instance only (no distributed lock)
 *
 * Storage format:
 * - {dataDir}/queues/{queueName}/jobs/{jobId}.json - Individual job files
 * - Jobs are loaded on init and kept in memory with fastq
 */

import * as fastq from 'fastq'
import type { queueAsPromised } from 'fastq'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type {
  QueueAdapter,
  JobInput,
  Job,
  JobsQuery,
  ScheduleOptions,
  JobCounts,
  QueueEvent,
  WorkerHandler,
  WorkerOptions,
} from '../interfaces/queue'

export interface FileQueueAdapterOptions {
  dataDir: string
  maxQueueSize?: number
}

interface QueueWorkerInfo {
  queue: queueAsPromised
  handlers: Map<string, WorkerHandler>
  paused: boolean
  concurrency: number
}

// Extended Job interface with opts for internal storage
interface JobWithOpts extends Job {
  opts?: {
    attempts?: number
    backoff?: {
      type: 'exponential' | 'fixed'
      delay: number
    }
    delay?: number
    priority?: number
    timeout?: number
  }
}

export class FileQueueAdapter implements QueueAdapter {
  private jobs = new Map<string, JobWithOpts>()
  private eventListeners = new Map<string, Array<(payload: any) => void>>()
  private workers = new Map<string, QueueWorkerInfo>()
  private options: FileQueueAdapterOptions
  private initialized = false

  constructor(options: FileQueueAdapterOptions) {
    this.options = {
      dataDir: options.dataDir,
      maxQueueSize: options.maxQueueSize || 10000,
    }
  }

  async init(): Promise<void> {
    if (this.initialized) return

    // Create data directory
    await fs.mkdir(join(this.options.dataDir, 'queues'), { recursive: true })

    // Load existing jobs from disk
    await this.loadJobsFromDisk()

    this.initialized = true
  }

  private async loadJobsFromDisk(): Promise<void> {
    const queuesDir = join(this.options.dataDir, 'queues')

    try {
      const queueNames = await fs.readdir(queuesDir)

      for (const queueName of queueNames) {
        const jobsDir = join(queuesDir, queueName, 'jobs')

        try {
          const jobFiles = await fs.readdir(jobsDir)

          for (const jobFile of jobFiles) {
            if (!jobFile.endsWith('.json')) continue

            const jobPath = join(jobsDir, jobFile)
            const jobData = await fs.readFile(jobPath, 'utf-8')
            const job: Job = JSON.parse(jobData)

            this.jobs.set(job.id, job)
          }
        }
        catch {
          // Queue directory doesn't exist yet
        }
      }
    }
    catch {
      // No queues directory yet
    }
  }

  private async persistJob(queueName: string, job: Job): Promise<void> {
    const jobsDir = join(this.options.dataDir, 'queues', queueName, 'jobs')
    await fs.mkdir(jobsDir, { recursive: true })

    const jobPath = join(jobsDir, `${job.id}.json`)
    await fs.writeFile(jobPath, JSON.stringify(job, null, 2))
  }

  private async deleteJobFile(queueName: string, jobId: string): Promise<void> {
    const jobPath = join(this.options.dataDir, 'queues', queueName, 'jobs', `${jobId}.json`)

    try {
      await fs.unlink(jobPath)
    }
    catch {
      // File might not exist
    }
  }

  async enqueue(queueName: string, job: JobInput): Promise<string> {
    // Use provided job ID if available (for idempotency), otherwise generate new one
    const jobId = job.opts?.jobId || this.generateId()

    // Check if job already exists (idempotency - prevent duplicate processing)
    if (this.jobs.has(jobId)) {
      // Job already enqueued - return existing job ID without creating duplicate
      return jobId
    }

    // Check queue size
    if (this.jobs.size >= this.options.maxQueueSize!) {
      throw new Error(`Queue ${queueName} is full (max: ${this.options.maxQueueSize})`)
    }

    // Create job with queueName stored in data for filtering
    const internalJob: JobWithOpts = {
      id: jobId,
      name: job.name,
      data: { ...job.data, __queueName: queueName },
      state: 'waiting',
      timestamp: Date.now(),
      attemptsMade: 0,
      opts: job.opts, // Store job options for retry logic
    }

    this.jobs.set(jobId, internalJob)

    // Persist to disk
    await this.persistJob(queueName, internalJob)

    // Emit waiting event
    this.emitEvent(queueName, 'waiting', { jobId, job: internalJob })

    // Dispatch to worker if registered
    const workerInfo = this.workers.get(queueName)
    if (workerInfo && !workerInfo.paused) {
      workerInfo.queue.push({ jobId, jobName: job.name, data: job.data }).catch((error) => {
        console.error(`[FileQueueAdapter] Error processing job ${jobId}:`, error)
      })
    }

    return jobId
  }

  async schedule(queueName: string, job: JobInput, opts?: ScheduleOptions): Promise<string> {
    // For file adapter, delayed jobs use setTimeout (not persisted across restarts)
    if (opts?.delay) {
      const jobId = this.generateId()

      const internalJob: Job = {
        id: jobId,
        name: job.name,
        data: { ...job.data, __queueName: queueName },
        state: 'delayed',
        timestamp: Date.now(),
      }

      this.jobs.set(jobId, internalJob)
      await this.persistJob(queueName, internalJob)

      // Emit delayed event
      this.emitEvent(queueName, 'delayed', { jobId, job: internalJob, delay: opts.delay })

      // Schedule with setTimeout
      setTimeout(() => {
        this.enqueue(queueName, job)
      }, opts.delay)

      return jobId
    }

    // Cron not supported (needs scheduler daemon)
    if (opts?.cron || opts?.repeat) {
      throw new Error('Cron/repeat scheduling not supported in file adapter')
    }

    return this.enqueue(queueName, job)
  }

  async getJob(_queueName: string, id: string): Promise<Job | null> {
    return this.jobs.get(id) || null
  }

  async getJobs(queueName: string, query?: JobsQuery): Promise<Job[]> {
    // Filter jobs by queue name first
    let jobs = Array.from(this.jobs.values()).filter(j => j.data?.__queueName === queueName)

    // Filter by state if specified
    if (query?.state && query.state.length > 0) {
      jobs = jobs.filter(j => query.state!.includes(j.state))
    }

    // Apply offset
    if (query?.offset) {
      jobs = jobs.slice(query.offset)
    }

    // Apply limit
    if (query?.limit) {
      jobs = jobs.slice(0, query.limit)
    }

    return jobs
  }

  on(queueName: string, event: QueueEvent, callback: (payload: any) => void): () => void {
    const key = `${queueName}:${event}`

    if (!this.eventListeners.has(key)) {
      this.eventListeners.set(key, [])
    }

    this.eventListeners.get(key)!.push(callback)

    // Return unsubscribe function
    return () => {
      const listeners = this.eventListeners.get(key)
      if (listeners) {
        const index = listeners.indexOf(callback)
        if (index > -1) {
          listeners.splice(index, 1)
        }
      }
    }
  }

  async isPaused(queueName: string): Promise<boolean> {
    const workerInfo = this.workers.get(queueName)
    return workerInfo?.paused || false
  }

  async getJobCounts(queueName: string): Promise<JobCounts> {
    // Filter jobs by queue name
    const jobs = Array.from(this.jobs.values()).filter(j => j.data?.__queueName === queueName)

    return {
      active: jobs.filter(j => j.state === 'active').length,
      completed: jobs.filter(j => j.state === 'completed').length,
      failed: jobs.filter(j => j.state === 'failed').length,
      delayed: jobs.filter(j => j.state === 'delayed').length,
      waiting: jobs.filter(j => j.state === 'waiting').length,
      paused: jobs.filter(j => j.state === 'paused').length,
    }
  }

  async pause(queueName: string): Promise<void> {
    const workerInfo = this.workers.get(queueName)
    if (workerInfo) {
      workerInfo.paused = true
      workerInfo.queue.pause()
    }
  }

  async resume(queueName: string): Promise<void> {
    const workerInfo = this.workers.get(queueName)
    if (workerInfo) {
      workerInfo.paused = false
      workerInfo.queue.resume()
    }
  }

  async close(): Promise<void> {
    // Drain all worker queues
    const drainPromises = Array.from(this.workers.values()).map(w => w.queue.drained())
    await Promise.all(drainPromises)

    // Persist all jobs before closing
    const persistPromises: Promise<void>[] = []
    for (const [_jobId, job] of Array.from(this.jobs.entries())) {
      // Extract queueName from job data (stored during enqueue)
      const queueName = job.data?.__queueName || 'default'
      persistPromises.push(this.persistJob(queueName, job))
    }

    await Promise.all(persistPromises)

    this.jobs.clear()
    this.eventListeners.clear()
    this.workers.clear()
  }

  // ============================================================
  // Worker Management
  // ============================================================

  registerWorker(
    queueName: string,
    jobName: string,
    handler: WorkerHandler,
    opts?: WorkerOptions,
  ): void {
    const requestedConcurrency = opts?.concurrency || 1
    let workerInfo = this.workers.get(queueName)

    if (workerInfo) {
      console.info(`[FileQueue] Adding handler for job "${jobName}" to queue "${queueName}"`)
      workerInfo.handlers.set(jobName, handler)

      // Update concurrency to maximum of all registered handlers in this queue
      if (requestedConcurrency > workerInfo.concurrency) {
        workerInfo.concurrency = requestedConcurrency
        // Update fastq concurrency dynamically
        workerInfo.queue.concurrency = requestedConcurrency
        console.info(`[FileQueue] Updated queue "${queueName}" concurrency to ${requestedConcurrency}`)
      }
      return
    }

    console.info(`[FileQueue] Creating new worker for queue: ${queueName}`)

    const handlers = new Map<string, WorkerHandler>()
    handlers.set(jobName, handler)

    // Dispatcher routes to correct handler
    const dispatcher = async (task: { jobId: string, jobName: string, data: any }) => {
      const handler = handlers.get(task.jobName)
      if (!handler) {
        const error = `No handler for job "${task.jobName}" on queue "${queueName}". `
          + `Available: ${Array.from(handlers.keys()).join(', ')}`
        console.error(error)
        throw new Error(error)
      }

      // Get the stored job to access opts and attemptsMade
      const storedJob = this.jobs.get(task.jobId)
      if (!storedJob) {
        throw new Error(`Job ${task.jobId} not found`)
      }

      const currentAttempts = storedJob.attemptsMade || 0
      const maxAttempts = storedJob.opts?.attempts || 1

      // Update job state to active and increment attempts
      await this.updateJobState(queueName, task.jobId, 'active', {
        processedOn: Date.now(),
        attemptsMade: currentAttempts + 1,
      })

      // Emit active event
      this.emitEvent(queueName, 'active', { jobId: task.jobId })

      try {
        // Build a BullMQ-like job object so the handler's processor logic works
        const jobLike = {
          id: task.jobId,
          name: task.jobName,
          data: task.data,
          attemptsMade: currentAttempts + 1,
          opts: { attempts: maxAttempts, ...storedJob.opts },
        }

        // Call the handler - it's a NodeHandler wrapped by createBullMQProcessor
        // which expects a job object and will build the full RunContext
        const result = await handler(jobLike as any, {} as any)

        // Update job state to completed
        await this.updateJobState(queueName, task.jobId, 'completed', {
          returnvalue: result,
          finishedOn: Date.now(),
        })

        // Emit completed event
        this.emitEvent(queueName, 'completed', { jobId: task.jobId, returnvalue: result })

        // Delete completed job file to avoid reprocessing on restart
        await this.deleteJobFile(queueName, task.jobId)

        return result
      }
      catch (err) {
        const newAttemptCount = currentAttempts + 1

        // Check if we should retry
        if (newAttemptCount < maxAttempts) {
          // Calculate backoff delay
          let retryDelay = 0
          if (storedJob.opts?.backoff) {
            const { type, delay } = storedJob.opts.backoff
            if (type === 'exponential') {
              retryDelay = delay * Math.pow(2, newAttemptCount - 1)
            }
            else {
              retryDelay = delay
            }
          }

          // Update job back to waiting for retry
          await this.updateJobState(queueName, task.jobId, 'waiting', {
            attemptsMade: newAttemptCount,
            failedReason: `Attempt ${newAttemptCount}/${maxAttempts} failed: ${(err as Error).message}`,
          })

          // Log retry
          console.info(
            `[FileQueue] Retrying job ${task.jobId} (attempt ${newAttemptCount}/${maxAttempts}) `
            + `after ${retryDelay}ms delay`,
          )

          // Schedule retry with backoff
          setTimeout(() => {
            workerInfo.queue.push(task).catch((retryErr) => {
              console.error(`[FileQueue] Error retrying job ${task.jobId}:`, retryErr)
            })
          }, retryDelay)

          // Don't throw - job will be retried
          return
        }

        // Max attempts reached - mark as failed
        await this.updateJobState(queueName, task.jobId, 'failed', {
          failedReason: `Failed after ${newAttemptCount} attempts: ${(err as Error).message}`,
          finishedOn: Date.now(),
          attemptsMade: newAttemptCount,
        })

        // Emit failed event
        this.emitEvent(queueName, 'failed', {
          jobId: task.jobId,
          failedReason: (err as Error).message,
          attemptsMade: newAttemptCount,
          maxAttempts,
        })

        throw err
      }
    }

    // Create fastq queue
    const concurrency = opts?.concurrency || 1
    const queue = fastq.promise(dispatcher, concurrency)

    const shouldPause = opts?.autorun === false

    workerInfo = {
      queue,
      handlers,
      paused: shouldPause || false,
      concurrency,
    }

    if (shouldPause) {
      queue.pause()
      console.info(`[FileQueue] Worker for "${queueName}" created but paused`)
    }

    this.workers.set(queueName, workerInfo)

    // NOTE: Don't load waiting jobs here - they will be loaded after all handlers
    // are registered to avoid "no handler" errors when jobs are processed before
    // all handlers are added. Call startProcessingQueue() after registration is complete.
  }

  /**
   * Start processing waiting jobs for a queue
   * Should be called after all handlers are registered
   */
  startProcessingQueue(queueName: string): void {
    const workerInfo = this.workers.get(queueName)
    if (!workerInfo || workerInfo.paused) return

    const waitingJobs = Array.from(this.jobs.values()).filter(j =>
      j.state === 'waiting' && j.data?.__queueName === queueName,
    )

    for (const job of waitingJobs) {
      workerInfo.queue.push({ jobId: job.id, jobName: job.name, data: job.data }).catch((error) => {
        console.error(`[FileQueueAdapter] Error processing queued job ${job.id}:`, error)
      })
    }
  }

  // ============================================================
  // Helper Methods
  // ============================================================

  private async updateJobState(queueName: string, jobId: string, state: Job['state'], extra?: Partial<Job>): Promise<void> {
    const job = this.jobs.get(jobId)
    if (job) {
      job.state = state
      if (extra) {
        Object.assign(job, extra)
      }

      // Persist updated job to disk
      await this.persistJob(queueName, job)
    }
  }

  private emitEvent(queueName: string, event: QueueEvent, payload: any) {
    const key = `${queueName}:${event}`
    const listeners = this.eventListeners.get(key) || []

    for (const callback of listeners) {
      try {
        callback(payload)
      }
      catch (error) {
        console.error(`[FileQueueAdapter] Error in event listener for ${key}:`, error)
      }
    }
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }
}
