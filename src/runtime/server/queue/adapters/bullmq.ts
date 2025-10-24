import { Queue, QueueEvents } from 'bullmq'
import type { JobsOptions, Job as BullJob } from 'bullmq'
import defu from 'defu'
import { useRuntimeConfig, useMetrics, $useQueueRegistry } from '#imports'
import { getEventBus } from '../../streams/eventBus'
import { getStreamFactory } from '../../streams/streamFactory'
import { getStreamNames } from '../../streams/streamNames'
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
    const { publish: publishEvent } = getEventBus()
    const { incCounter } = useMetrics()
    const rc = useRuntimeConfig() as any
    const connection = rc.queue?.redis
    // Derive provider-agnostic queue options from registry (defaultJobOptions, prefix)
    let queueDefaults: any = undefined
    let prefix: string | undefined
    try {
      const registry: any = $useQueueRegistry()
      if (registry && Array.isArray(registry.workers)) {
        const w = registry.workers.find((w: any) => w?.queue === name && w?.queueCfg)
        if (w?.queueCfg) {
          queueDefaults = w.queueCfg.defaultJobOptions
          prefix = w.queueCfg.prefix
        }
      }
    }
    catch {
      // ignore registry access errors
    }
    const queue = new Queue(name, { connection, prefix, defaultJobOptions: queueDefaults })
    const events = new QueueEvents(name, { connection })
    cached = { queue, events, wired: false, defaults: queueDefaults }
    this.queues.set(name, cached)
    // Wire event forwarding once per queue
    if (!cached.wired) {
      const forward = async (kind: string, payload: any) => {
        // metrics
        try {
          incCounter('queue_job_events_total', { kind, queue: name })
        }
        catch {
          // ignore
        }
        const rec = {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          ts: new Date().toISOString(),
          kind: `job.${kind}`,
          subject: name,
          data: payload,
          v: 1,
        }
        const streamsCfg = getStreamNames()
        const streams = [
          streamsCfg.global,
          typeof (streamsCfg as any).queue === 'function' ? (streamsCfg as any).queue(name) : String((streamsCfg as any).queue) + String(name),
          payload?.jobId ? (typeof (streamsCfg as any).job === 'function' ? (streamsCfg as any).job(payload.jobId) : String((streamsCfg as any).job) + String(payload.jobId)) : undefined,
        ].filter(Boolean) as string[]
        const factory = getStreamFactory()
        for (const s of streams) {
          const saved = await factory.adapter.append(s, rec as any)
          publishEvent(saved)
        }
      }
      for (const ev of ['waiting', 'active', 'progress', 'completed', 'failed', 'delayed'] as const) {
        events.on(ev as any, (p: any) => {
          void forward(ev, p)
        })
      }
      cached.wired = true
    }
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
    return this.toJob(j)
  }

  async getJobs(queueName: string, _q?: JobsQuery): Promise<Job[]> {
    const { queue } = this.ensureQueue(queueName)
    const jobs = await queue.getJobs(['waiting', 'active', 'completed', 'failed', 'delayed'], 0, 50)
    return jobs.map(j => this.toJob(j))
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
    for (const { queue, events } of this.queues.values()) {
      await Promise.allSettled([
        queue.close(),
        events.close(),
      ])
    }
    this.queues.clear()
  }

  private toJob(j: BullJob): Job {
    return {
      id: j.id as string,
      name: j.name,
      data: j.data,
      progress: typeof j.progress === 'number' ? j.progress : undefined,
      returnvalue: (j as any).returnvalue,
      failedReason: j.failedReason,
      // state resolved by caller when needed
    }
  }
}
