import { Queue, QueueEvents } from 'bullmq'
import type { JobsOptions, Job as BullJob } from 'bullmq'
import defu from 'defu'
import { useRuntimeConfig, $useQueueRegistry, useEventManager } from '#imports'
import type { QueueProvider, JobInput, Job, JobsQuery, ScheduleOptions, QueueEvent, JobCounts } from '../types'

interface QueueCache {
  queue: Queue
  events: QueueEvents
  wired?: boolean
  defaults?: any
}

export class BullMQProvider implements QueueProvider {
  private queues = new Map<string, QueueCache>()

  async init(): Promise<void> {
    // Lazy creation on first use; nothing to do here
  }

  private ensureQueue(name: string): QueueCache {
    let cached = this.queues.get(name)
    if (cached) return cached
    const { publishBus } = useEventManager()
    const rc = useRuntimeConfig() as any
    const connection = rc.queue?.queue?.redis
    // Derive provider-agnostic queue options from registry (defaultJobOptions, prefix, limiter)
    let queueDefaults: any = undefined
    let prefix: string | undefined
    let limiter: any = undefined
    try {
      const registry: any = $useQueueRegistry()
      if (registry && Array.isArray(registry.workers)) {
        const w = registry.workers.find((w: any) => w?.queue?.name === name)
        if (w?.queue) {
          queueDefaults = w.queue.defaultJobOptions
          prefix = w.queue.prefix
          limiter = w.queue.limiter
        }
      }
    }
    catch {
      // ignore registry access errors
    }

    // Build BullMQ-specific queue options
    const queueOpts: any = { connection, prefix, defaultJobOptions: queueDefaults }

    // Map generic limiter config to BullMQ limiter format
    if (limiter) {
      queueOpts.limiter = {
        max: limiter.max,
        duration: limiter.duration,
        groupKey: limiter.groupKey,
      }
    }

    const queue = new Queue(name, queueOpts)
    const events = new QueueEvents(name, { connection, prefix })

    // Increase max listeners to prevent warnings during development (HMR can cause multiple subscriptions)
    events.setMaxListeners(50)

    cached = { queue, events, wired: false, defaults: queueDefaults }
    this.queues.set(name, cached)

    // Wire event forwarding once per queue
    const forward = async (kind: string, payload: any) => {
      // Publish ONLY to the in-proc bus. Do NOT persist queue/job/global events in the stream store.
      // Try to extract runId from job data if available
      const jobId = (payload as any)?.jobId || 'unknown'

      // Try to fetch the job to get flowId/runId from data
      let runId = ''
      try {
        if (jobId && jobId !== 'unknown') {
          const job = await queue.getJob(jobId)
          if (job?.data?.flowId) {
            runId = job.data.flowId
          }
        }
      }
      catch {
        // Ignore errors fetching job, use empty runId
      }

      const rec = {
        type: `job.${kind}`,
        runId,
        data: { ...payload, queue: name, jobId },
      }
      // Publish directly to the in-proc bus via EventManager abstraction
      await publishBus(rec as any)
    }
    for (const ev of ['waiting', 'active', 'progress', 'completed', 'failed', 'delayed'] as const) {
      events.on(ev as any, (p: any) => {
        void forward(ev, p)
      })
    }
    cached.wired = true

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
    if (opts?.delay) jobsOpts.delay = opts.delay
    if (opts?.cron) jobsOpts.repeat = { pattern: opts.cron }
    const bullJob = await queue.add(job.name, job.data, jobsOpts)
    return bullJob.id as string
  }

  async getJob(queueName: string, id: string): Promise<Job | null> {
    const { queue } = this.ensureQueue(queueName)
    const j = await queue.getJob(id)
    if (!j) return null
    return await this.toJob(j)
  }

  async getJobs(queueName: string, _q?: JobsQuery): Promise<Job[]> {
    const { queue } = this.ensureQueue(queueName)

    // Determine which states to query
    const states = _q?.state && _q.state.length > 0
      ? _q.state
      : ['waiting', 'active', 'completed', 'failed', 'delayed', 'paused']

    // Fetch with limit if provided, otherwise get up to 1000
    const limit = _q?.limit || 1000
    const jobs = await queue.getJobs(states as any, 0, limit - 1)
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
    const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused') as Record<string, number>
    // Normalize to full shape
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

  async close(): Promise<void> {
    const closePromises: Promise<void>[] = []

    for (const [queueName, { queue, events }] of this.queues.entries()) {
      // Close queue and events, ignoring EPIPE errors during HMR
      closePromises.push(
        queue.close().catch((err) => {
          if (err.code !== 'EPIPE' && !err.message?.includes('Connection is closed')) {
            console.warn(`[BullMQProvider] Error closing queue "${queueName}":`, err.message)
          }
        }),
      )
      closePromises.push(
        events.close().catch((err) => {
          if (err.code !== 'EPIPE' && !err.message?.includes('Connection is closed')) {
            console.warn(`[BullMQProvider] Error closing events for queue "${queueName}":`, err.message)
          }
        }),
      )
    }

    await Promise.allSettled(closePromises)
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
      state: state as 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'paused',
      timestamp: j.timestamp,
      processedOn: j.processedOn,
      finishedOn: j.finishedOn,
    }
  }
}
