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
import cronParser from 'cron-parser'
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

interface ScheduledJob {
  queueName: string
  job: JobInput
  opts: ScheduleOptions
  timerId?: NodeJS.Timeout
  repeatCount: number
}

export class FileQueueAdapter implements QueueAdapter {
  private jobs = new Map<string, JobWithOpts>()
  private eventListeners = new Map<string, Array<(payload: any) => void>>()
  private workers = new Map<string, QueueWorkerInfo>()
  private scheduledJobs = new Map<string, ScheduledJob>()
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
      // Don't catch errors here - let them propagate to dispatcher for retry handling
      workerInfo.queue.push({ jobId, jobName: job.name, data: job.data }).catch(() => {
        // Errors are handled by dispatcher's retry logic
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

    // Handle cron and repeat scheduling
    if (opts?.cron || opts?.repeat) {
      const scheduleId = this.generateId()
      const cronPattern = opts.cron || opts.repeat?.pattern

      if (!cronPattern) {
        throw new Error('Cron pattern is required for scheduled jobs')
      }

      // Create scheduled job entry
      const scheduledJob: ScheduledJob = {
        queueName,
        job,
        opts,
        repeatCount: 0,
      }

      this.scheduledJobs.set(scheduleId, scheduledJob)

      // Start the cron schedule
      this.scheduleCronJob(scheduleId, scheduledJob)

      console.info(`[FileQueue] Scheduled job "${job.name}" with cron pattern "${cronPattern}" (id: ${scheduleId})`)

      return scheduleId
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

  async getScheduledJobs(queueName: string): Promise<Array<any>> {
    const scheduled: Array<any> = []

    for (const [scheduleId, scheduledJob] of this.scheduledJobs.entries()) {
      if (scheduledJob.queueName === queueName) {
        const cronPattern = scheduledJob.opts.cron || scheduledJob.opts.repeat?.pattern
        let nextRun: Date | undefined

        // Calculate next run time
        if (cronPattern) {
          try {
            const interval = cronParser.parseExpression(cronPattern)
            nextRun = interval.next().toDate()
          }
          catch {
            // Ignore parse errors for display
          }
        }

        scheduled.push({
          id: scheduleId,
          jobName: scheduledJob.job.name,
          queueName: scheduledJob.queueName,
          cron: scheduledJob.opts.cron,
          pattern: scheduledJob.opts.repeat?.pattern,
          nextRun,
          repeatCount: scheduledJob.repeatCount,
          limit: scheduledJob.opts.repeat?.limit,
        })
      }
    }

    return scheduled
  }

  async removeScheduledJob(scheduleId: string): Promise<boolean> {
    const scheduledJob = this.scheduledJobs.get(scheduleId)

    if (!scheduledJob) {
      return false
    }

    // Clear the timer
    if (scheduledJob.timerId) {
      clearTimeout(scheduledJob.timerId)
    }

    // Remove from map
    this.scheduledJobs.delete(scheduleId)

    console.info(`[FileQueue] Removed scheduled job: ${scheduleId}`)

    return true
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
    // Stop all scheduled jobs
    for (const [scheduleId, scheduledJob] of this.scheduledJobs.entries()) {
      if (scheduledJob.timerId) {
        clearTimeout(scheduledJob.timerId)
      }
      console.info(`[FileQueue] Stopped scheduled job: ${scheduleId}`)
    }
    this.scheduledJobs.clear()

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

      // Update job state to active
      // Note: We increment attemptsMade AFTER the attempt completes (on retry),
      // so during processing it shows the number of COMPLETED attempts (0 for first attempt)
      await this.updateJobState(queueName, task.jobId, 'active', {
        processedOn: Date.now(),
      })

      // Emit active event
      this.emitEvent(queueName, 'active', { jobId: task.jobId })

      try {
        // Build a BullMQ-like job object so the handler's processor logic works
        // attemptsMade is 0-indexed: 0 = first attempt, 1 = second attempt, etc.
        const jobLike = {
          id: task.jobId,
          name: task.jobName,
          data: task.data,
          attemptsMade: currentAttempts,
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
          // Increment attemptsMade to track completed attempts (0 = first attempt completed)
          await this.updateJobState(queueName, task.jobId, 'waiting', {
            attemptsMade: newAttemptCount,
            failedReason: `Attempt ${newAttemptCount}/${maxAttempts} failed: ${(err as Error).message}`,
          })

          // Log retry
          console.info(
            `[FileQueue] Retrying job ${task.jobId} (attempt ${newAttemptCount + 1}/${maxAttempts}) `
            + `after ${retryDelay}ms delay`,
          )

          // Schedule retry with backoff
          const currentWorkerInfo = this.workers.get(queueName)
          if (currentWorkerInfo) {
            setTimeout(() => {
              currentWorkerInfo.queue.push(task).catch(() => {
                // Errors will be handled by retry logic
              })
            }, retryDelay)
          }

          // Throw the error so the runner can emit step.failed and step.retry events
          // The retry is already scheduled above, so this just lets the events flow
          throw err
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
      // Don't catch errors here - let them propagate to dispatcher for retry handling
      workerInfo.queue.push({ jobId: job.id, jobName: job.name, data: job.data }).catch(() => {
        // Errors are handled by dispatcher's retry logic
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

  private scheduleCronJob(scheduleId: string, scheduledJob: ScheduledJob): void {
    const cronPattern = scheduledJob.opts.cron || scheduledJob.opts.repeat?.pattern

    if (!cronPattern) {
      console.error(`[FileQueue] No cron pattern found for schedule ${scheduleId}`)
      return
    }

    try {
      // Parse the cron expression
      const interval = cronParser.parseExpression(cronPattern)
      const nextRun = interval.next().toDate()
      const now = new Date()
      const delay = nextRun.getTime() - now.getTime()

      console.info(
        `[FileQueue] Next run for schedule ${scheduleId}: ${nextRun.toISOString()} (in ${Math.round(delay / 1000)}s)`,
      )

      // Schedule the next execution
      scheduledJob.timerId = setTimeout(async () => {
        // Check if we've hit the repeat limit
        const limit = scheduledJob.opts.repeat?.limit
        if (limit !== undefined && scheduledJob.repeatCount >= limit) {
          console.info(`[FileQueue] Schedule ${scheduleId} reached repeat limit (${limit})`)
          this.scheduledJobs.delete(scheduleId)
          return
        }

        // Execute the job
        try {
          await this.enqueue(scheduledJob.queueName, scheduledJob.job)
          scheduledJob.repeatCount++

          // Schedule the next run (if not at limit)
          const shouldContinue = limit === undefined || scheduledJob.repeatCount < limit
          if (shouldContinue) {
            this.scheduleCronJob(scheduleId, scheduledJob)
          }
          else {
            console.info(`[FileQueue] Schedule ${scheduleId} completed all ${limit} runs`)
            this.scheduledJobs.delete(scheduleId)
          }
        }
        catch (error) {
          console.error(`[FileQueue] Error executing scheduled job ${scheduleId}:`, error)
          // Continue scheduling even if one execution fails
          this.scheduleCronJob(scheduleId, scheduledJob)
        }
      }, delay)
    }
    catch (error) {
      console.error(`[FileQueue] Error parsing cron expression "${cronPattern}":`, error)
      throw new Error(`Invalid cron pattern: ${cronPattern}`)
    }
  }
}
