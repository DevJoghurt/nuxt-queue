/**
 * Memory Queue Adapter
 *
 * In-memory queue implementation using fastq for development
 * - Fast and simple
 * - No external dependencies beyond fastq
 * - Data lost on restart
 * - Single instance only
 *
 * Architecture:
 * - QueueAdapter: Manages job storage and queue events
 * - WorkerManager: Executes jobs using fastq
 * - Dispatcher pattern: Routes jobs to handlers by job.name
 */

import * as fastq from 'fastq'
import type { queueAsPromised } from 'fastq'
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

export interface MemoryQueueAdapterOptions {
  maxQueueSize?: number
}

interface QueueWorkerInfo {
  queue: queueAsPromised
  handlers: Map<string, WorkerHandler>
  paused: boolean
  concurrency: number
}

export class MemoryQueueAdapter implements QueueAdapter {
  private jobs = new Map<string, Job>()
  private eventListeners = new Map<string, Array<(payload: any) => void>>()
  private workers = new Map<string, QueueWorkerInfo>()
  private options: MemoryQueueAdapterOptions

  constructor(options: MemoryQueueAdapterOptions = {}) {
    this.options = {
      maxQueueSize: options.maxQueueSize || 1000,
    }
  }

  async init(): Promise<void> {
    // Nothing to initialize for in-memory
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
    const internalJob: Job = {
      id: jobId,
      name: job.name,
      data: { ...job.data, __queueName: queueName },
      state: 'waiting',
      timestamp: Date.now(),
    }

    this.jobs.set(jobId, internalJob)

    // Emit waiting event
    this.emitEvent(queueName, 'waiting', { jobId, job: internalJob })

    // Dispatch to worker if registered
    const workerInfo = this.workers.get(queueName)
    if (workerInfo && !workerInfo.paused) {
      workerInfo.queue.push({ jobId, jobName: job.name, data: job.data }).catch((error) => {
        console.error(`[MemoryQueueAdapter] Error processing job ${jobId}:`, error)
      })
    }

    return jobId
  }

  async schedule(queueName: string, job: JobInput, opts?: ScheduleOptions): Promise<string> {
    // For memory adapter, delayed jobs use setTimeout
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

      // Emit delayed event
      this.emitEvent(queueName, 'delayed', { jobId, job: internalJob, delay: opts.delay })

      // Schedule with setTimeout
      setTimeout(() => {
        this.enqueue(queueName, job)
      }, opts.delay)

      return jobId
    }

    // Cron not supported in memory adapter (needs persistent storage)
    if (opts?.cron || opts?.repeat) {
      throw new Error('Cron/repeat scheduling not supported in memory adapter')
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

    this.jobs.clear()
    this.eventListeners.clear()
    this.workers.clear()
  }

  // ============================================================
  // Worker Management (used by worker registration system)
  // ============================================================

  /**
   * Register a worker handler for a queue
   * This is called by the worker registration system
   */
  registerWorker(
    queueName: string,
    jobName: string,
    handler: WorkerHandler,
    opts?: WorkerOptions,
  ): void {
    let workerInfo = this.workers.get(queueName)

    if (workerInfo) {
      // Worker exists - add handler (same as BullMQ adapter)
      console.info(`[MemoryQueue] Adding handler for job "${jobName}" to queue "${queueName}"`)
      workerInfo.handlers.set(jobName, handler)
      return
    }

    // Create new fastq worker with dispatcher
    console.info(`[MemoryQueue] Creating new worker for queue: ${queueName}`)

    const handlers = new Map<string, WorkerHandler>()
    handlers.set(jobName, handler)

    // Dispatcher routes to correct handler (same pattern as BullMQ adapter)
    const dispatcher = async (task: { jobId: string, jobName: string, data: any }) => {
      const handler = handlers.get(task.jobName)
      if (!handler) {
        const error = `No handler for job "${task.jobName}" on queue "${queueName}". `
          + `Available: ${Array.from(handlers.keys()).join(', ')}`
        console.error(error)
        throw new Error(error)
      }

      // Update job state to active
      this.updateJobState(task.jobId, 'active', { processedOn: Date.now() })

      // Emit active event
      this.emitEvent(queueName, 'active', { jobId: task.jobId })

      try {
        // Execute handler (handler receives (payload, ctx))
        const result = await handler(task.data, {
          jobId: task.jobId,
          queueName,
          // Add more context as needed
        })

        // Check if job is awaiting (awaitBefore pattern)
        // If so, remove from jobs map so it can be re-enqueued with resolved data
        if (result && typeof result === 'object' && (result as any).awaiting === true) {
          this.jobs.delete(task.jobId)
          return result
        }

        // Update job state to completed
        this.updateJobState(task.jobId, 'completed', {
          returnvalue: result,
          finishedOn: Date.now(),
        })

        // Emit completed event
        this.emitEvent(queueName, 'completed', { jobId: task.jobId, returnvalue: result })

        return result
      }
      catch (err) {
        // Update job state to failed
        this.updateJobState(task.jobId, 'failed', {
          failedReason: (err as Error).message,
          finishedOn: Date.now(),
        })

        // Emit failed event
        this.emitEvent(queueName, 'failed', {
          jobId: task.jobId,
          failedReason: (err as Error).message,
        })

        throw err
      }
    }

    // Create fastq queue (like BullMQ Worker)
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
      console.info(`[MemoryQueue] Worker for "${queueName}" created but paused`)
    }

    this.workers.set(queueName, workerInfo)

    // NOTE: Don't load waiting jobs here - they will be loaded after all handlers
    // are registered to avoid "no handler" errors. Call startProcessingQueue() after registration.
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
        console.error(`[MemoryQueueAdapter] Error processing queued job ${job.id}:`, error)
      })
    }
  }

  // ============================================================
  // Helper Methods
  // ============================================================

  /**
   * Update job state (called internally and by worker manager)
   */
  updateJobState(jobId: string, state: Job['state'], extra?: Partial<Job>): void {
    const job = this.jobs.get(jobId)
    if (job) {
      job.state = state
      if (extra) {
        Object.assign(job, extra)
      }
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
        console.error(`[MemoryQueueAdapter] Error in event listener for ${key}:`, error)
      }
    }
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }
}
