/**
 * Redis Queue Adapter for nvent
 *
 * Uses BullMQ for Redis-based job queue
 * Extracted from nvent core in v0.4.1
 */

import { Queue, QueueEvents, Worker } from 'bullmq'
import type { JobsOptions, Job as BullJob } from 'bullmq'
import { defineNitroPlugin } from 'nitropack/runtime'
import { useRuntimeConfig, registerQueueAdapter } from '#imports'
import defu from 'defu'
import type {
  QueueAdapter,
  JobInput,
  Job,
  JobsQuery,
  ScheduleOptions,
  QueueEvent,
  JobCounts,
  WorkerHandler,
  WorkerOptions,
} from '#nvent/adapters'

export interface RedisQueueAdapterOptions {
  connection?: {
    host?: string
    port?: number
    username?: string
    password?: string
    db?: number
    url?: string
  }
  prefix?: string
  defaultJobOptions?: JobsOptions
}

interface QueueCache {
  queue: Queue
  events: QueueEvents
  defaults?: JobsOptions
}

interface WorkerInfo {
  worker: Worker
  handlers: Map<string, WorkerHandler>
}

export class RedisQueueAdapter implements QueueAdapter {
  private queues = new Map<string, QueueCache>()
  private workers = new Map<string, WorkerInfo>()
  private options: RedisQueueAdapterOptions

  constructor(options: RedisQueueAdapterOptions = {}) {
    this.options = options
  }

  async init(): Promise<void> {
    // Lazy creation on first use; nothing to do here
  }

  private ensureQueue(name: string): QueueCache {
    let cached = this.queues.get(name)
    if (cached) {
      return cached
    }

    const connection = this.options.connection
    const prefix = this.options.prefix
    const queueDefaults = this.options.defaultJobOptions

    // Build BullMQ-specific queue options
    const queueOpts: any = {
      connection,
      prefix,
      defaultJobOptions: queueDefaults,
    }

    const queue = new Queue(name, queueOpts)
    const events = new QueueEvents(name, { connection, prefix })

    // Increase max listeners to prevent warnings during development (HMR can cause multiple subscriptions)
    events.setMaxListeners(50)

    cached = { queue, events, defaults: queueDefaults }
    this.queues.set(name, cached)

    return cached
  }

  async enqueue(queueName: string, job: JobInput): Promise<string> {
    const { queue, defaults } = this.ensureQueue(queueName)
    const opts: JobsOptions | undefined = defu((job.opts as any) || {}, defaults || {})
    const bullJob = await queue.add(job.name, job.data, opts)
    return bullJob.id as string
  }

  async schedule(queueName: string, job: JobInput, opts?: ScheduleOptions): Promise<string> {
    const { queue, defaults } = this.ensureQueue(queueName)
    const jobsOpts: JobsOptions = defu({ ...(job.opts as any) }, defaults || {}) as any

    if (opts?.delay) {
      jobsOpts.delay = opts.delay
    }

    if (opts?.cron) {
      jobsOpts.repeat = { pattern: opts.cron }
    }

    if (opts?.repeat) {
      jobsOpts.repeat = {
        pattern: opts.repeat.pattern,
        limit: opts.repeat.limit,
      }
    }

    const bullJob = await queue.add(job.name, job.data, jobsOpts)
    return bullJob.id as string
  }

  async getJob(queueName: string, id: string): Promise<Job | null> {
    const { queue } = this.ensureQueue(queueName)
    const j = await queue.getJob(id)
    if (!j) {
      return null
    }
    return await this.toJob(j)
  }

  async getJobs(queueName: string, query?: JobsQuery): Promise<Job[]> {
    const { queue } = this.ensureQueue(queueName)

    // Determine which states to query
    const states = query?.state && query.state.length > 0
      ? query.state
      : ['waiting', 'active', 'completed', 'failed', 'delayed', 'paused']

    // Apply offset and limit
    const start = query?.offset || 0
    const limit = query?.limit || 1000
    const end = start + limit - 1

    const jobs = await queue.getJobs(states as any, start, end)
    return await Promise.all(jobs.map(j => this.toJob(j)))
  }

  on(queueName: string, event: QueueEvent, cb: (p: any) => void): () => void {
    const { events } = this.ensureQueue(queueName)
    const handler = (payload: any) => cb(payload)
    events.on(event as any, handler)
    return () => {
      events.off(event as any, handler)
    }
  }

  async isPaused(queueName: string): Promise<boolean> {
    const { queue } = this.ensureQueue(queueName)
    return await queue.isPaused()
  }

  async getJobCounts(queueName: string): Promise<JobCounts> {
    const { queue } = this.ensureQueue(queueName)
    const counts = await queue.getJobCounts(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed',
      'paused',
    ) as Record<string, number>

    return {
      active: counts.active || 0,
      completed: counts.completed || 0,
      failed: counts.failed || 0,
      delayed: counts.delayed || 0,
      waiting: counts.waiting || 0,
      paused: counts.paused || 0,
    }
  }

  async pause(queueName: string): Promise<void> {
    const { queue } = this.ensureQueue(queueName)
    await queue.pause()
  }

  async resume(queueName: string): Promise<void> {
    const { queue } = this.ensureQueue(queueName)
    await queue.resume()
  }

  async getScheduledJobs(queueName: string): Promise<Array<any>> {
    const { queue } = this.ensureQueue(queueName)

    // Get all repeatable jobs from BullMQ
    const repeatableJobs = await queue.getRepeatableJobs()

    return repeatableJobs.map(job => ({
      id: job.key, // BullMQ uses 'key' as the unique identifier for repeatable jobs
      jobName: job.name,
      queueName,
      cron: job.pattern,
      pattern: job.pattern,
      nextRun: job.next ? new Date(job.next) : undefined,
      repeatCount: undefined, // BullMQ doesn't track this directly
      limit: undefined, // Not exposed in RepeatableJob type
    }))
  }

  async removeScheduledJob(scheduleId: string): Promise<boolean> {
    // The scheduleId is the job key from BullMQ
    // We need to parse it to extract queue name and job details
    // BullMQ repeatable job keys are in format: "repeat:{name}:{id}:{pattern}"

    // Try to find the job across all queues
    for (const [queueName, { queue }] of this.queues.entries()) {
      try {
        const repeatableJobs = await queue.getRepeatableJobs()
        const job = repeatableJobs.find(j => j.key === scheduleId)

        if (job) {
          await queue.removeRepeatableByKey(scheduleId)
          console.info(`[RedisQueueAdapter] Removed scheduled job: ${scheduleId}`)
          return true
        }
      }
      catch (error) {
        console.error(`[RedisQueueAdapter] Error removing scheduled job ${scheduleId} from queue ${queueName}:`, error)
      }
    }

    return false
  }

  registerWorker(
    queueName: string,
    jobName: string,
    handler: WorkerHandler,
    opts?: WorkerOptions,
  ): void {
    let workerInfo = this.workers.get(queueName)

    if (workerInfo) {
      // Worker exists - add handler (dispatcher pattern)
      console.info(`[RedisQueueAdapter] Adding handler for job "${jobName}" to queue "${queueName}"`)
      workerInfo.handlers.set(jobName, handler)
      return
    }

    // Create new BullMQ Worker with dispatcher
    console.info(`[RedisQueueAdapter] Creating new worker for queue: ${queueName}`)

    const handlers = new Map<string, WorkerHandler>()
    handlers.set(jobName, handler)

    const connection = this.options.connection
    const prefix = this.options.prefix

    // Dispatcher routes to correct handler by job.name
    const dispatcher = async (job: BullJob) => {
      const handler = handlers.get(job.name)
      if (!handler) {
        const error = `No handler for job "${job.name}" on queue "${queueName}". `
          + `Available: ${Array.from(handlers.keys()).join(', ')}`
        console.error(error)
        throw new Error(error)
      }

      // Execute handler - handler expects (job, context) where job is the full BullMQ job
      // The worker processor (createJobProcessor) will extract job.data and build RunContext
      const result = await handler(job as any, {
        jobId: job.id as string,
        queueName,
      } as any)

      return result
    }

    // Create BullMQ Worker with all supported options
    const concurrency = opts?.concurrency || 1
    const workerOpts: any = {
      connection: connection as any,
      prefix,
      concurrency,
      autorun: opts?.autorun !== false, // Default to true
    }

    // Add BullMQ-specific worker options if provided
    // Cast opts to access BullMQ-specific properties
    const bullOpts = opts as any
    if (typeof bullOpts?.lockDurationMs === 'number') {
      workerOpts.lockDuration = bullOpts.lockDurationMs
    }
    if (typeof bullOpts?.maxStalledCount === 'number') {
      workerOpts.maxStalledCount = bullOpts.maxStalledCount
    }
    if (typeof bullOpts?.drainDelayMs === 'number') {
      workerOpts.drainDelay = bullOpts.drainDelayMs
    }

    const worker = new Worker(queueName, dispatcher, workerOpts)

    // Error handling
    worker.on('failed', (job, err) => {
      console.error(`[RedisQueueAdapter] Job ${job?.id} failed:`, err)
    })

    workerInfo = {
      worker,
      handlers,
    }

    this.workers.set(queueName, workerInfo)
  }

  async close(): Promise<void> {
    const closePromises: Promise<void>[] = []

    // Close workers first
    Array.from(this.workers.entries()).forEach(([, { worker }]) => {
      closePromises.push(
        worker.close().catch((err) => {
          if (err.code !== 'EPIPE' && !err.message?.includes('Connection is closed')) {
            console.warn('[RedisQueueAdapter] Error closing worker:', err)
          }
        }),
      )
    })

    // Close queues and events
    Array.from(this.queues.entries()).forEach(([, { queue, events }]) => {
      closePromises.push(
        queue.close().catch((err) => {
          if (err.code !== 'EPIPE' && !err.message?.includes('Connection is closed')) {
            console.warn('[RedisQueueAdapter] Error closing queue:', err)
          }
        }),
      )
      closePromises.push(
        events.close().catch((err) => {
          if (err.code !== 'EPIPE' && !err.message?.includes('Connection is closed')) {
            console.warn('[RedisQueueAdapter] Error closing events:', err)
          }
        }),
      )
    })

    await Promise.allSettled(closePromises)
    this.workers.clear()
    this.queues.clear()
  }

  private async toJob(j: BullJob): Promise<Job> {
    // Get the current state of the job
    const state = await j.getState()

    return {
      id: j.id as string,
      name: j.name,
      data: j.data,
      returnvalue: (j as any).returnvalue,
      failedReason: j.failedReason,
      state: state as Job['state'],
      timestamp: j.timestamp,
      processedOn: j.processedOn,
      finishedOn: j.finishedOn,
      attemptsMade: j.attemptsMade,
      progress: (j as any).progress,
    }
  }
}

// Nitro plugin to register this adapter via hook
export default defineNitroPlugin(async (nitroApp) => {
  // Listen to the registration hook from nvent
  nitroApp.hooks.hook('nvent:register-adapters' as any, () => {
    const runtimeConfig = useRuntimeConfig()
    const moduleOptions = (runtimeConfig as any).nventQueueRedis || {}
    const nventConfig = (runtimeConfig as any).nvent || {}

    // Get connection from module options, nvent config, or connections config
    const connection = moduleOptions.connection
      || nventConfig.queue?.connection
      || nventConfig.connections?.redis

    if (!connection) {
      console.warn('[adapter-queue-redis] No Redis connection config found')
    }

    const config = defu(moduleOptions, {
      connection,
      prefix: nventConfig.queue?.prefix || 'nq',
      defaultJobOptions: nventConfig.queue?.defaultJobOptions,
    })

    // Create and register adapter
    const adapter = new RedisQueueAdapter({
      connection: config.connection,
      prefix: config.prefix,
      defaultJobOptions: config.defaultJobOptions,
    })

    registerQueueAdapter('redis', adapter)

    console.log('[adapter-queue-redis] Redis queue adapter registered')
  })
})
