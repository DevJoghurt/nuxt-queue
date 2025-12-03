/**
 * Scheduler
 *
 * Store-based scheduler with distributed locking for horizontal scaling.
 * Ensures only one instance executes each scheduled job.
 */

import { CronJob } from 'cron'
import type { ScheduledJob, SchedulerAdapter, SchedulerLock } from './types'
import type { StoreAdapter } from '../adapters/interfaces/store'
import { getEventBus } from '../events/eventBus'
import { resolveTimeAwait } from '../nitro/utils/awaitPatterns/time'
import { resolveScheduleAwait } from '../nitro/utils/awaitPatterns/schedule'
import { useNventLogger } from '#imports'

export interface SchedulerOptions {
  /**
   * Store adapter for locking (Redis recommended)
   */
  store: StoreAdapter

  /**
   * Key prefix for locks and job data
   * Uses configured store prefix + ':scheduler'
   * @default '{prefix}:scheduler' (e.g., 'nvent:scheduler')
   */
  keyPrefix?: string

  /**
   * Lock TTL in milliseconds
   * @default 300000 (5 minutes)
   */
  lockTTL?: number

  /**
   * Unique instance identifier
   * @default Auto-generated
   */
  instanceId?: string

  /**
   * Use store indexes for locking (more robust) vs simple KV
   * @default true
   */
  useIndexLocking?: boolean
}

export class Scheduler implements SchedulerAdapter {
  private store: StoreAdapter
  private keyPrefix: string
  private lockTTL: number
  private instanceId: string
  private useIndexLocking: boolean
  private jobs = new Map<string, CronJob | NodeJS.Timeout>()
  private jobConfigs = new Map<string, ScheduledJob>()
  private lockRenewalTimers = new Map<string, NodeJS.Timeout>()
  private started = false
  private logger = useNventLogger('scheduler')

  constructor(options: SchedulerOptions) {
    this.store = options.store
    this.keyPrefix = options.keyPrefix || 'nvent:scheduler'
    this.lockTTL = options.lockTTL || 300000 // 5 minutes
    this.instanceId = options.instanceId || `instance-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
    this.useIndexLocking = options.useIndexLocking !== false
  }

  async schedule(job: ScheduledJob): Promise<string> {
    // Store job config
    this.jobConfigs.set(job.id, job)
    await this.persistJob(job)

    if (job.type === 'cron' && job.cron) {
      const cronJob = new CronJob(
        job.cron,
        async () => {
          await this.executeWithLock(job)
        },
        null,
        job.enabled !== false && this.started,
        job.timezone || 'UTC',
      )

      this.jobs.set(job.id, cronJob)

      // Calculate next run
      const nextDate = cronJob.nextDate()
      if (nextDate) {
        job.nextRun = nextDate.toMillis()
        await this.updateJobStats(job.id, { nextRun: job.nextRun })
      }

      return job.id
    }

    if (job.type === 'interval' && job.interval) {
      if (job.enabled !== false && this.started) {
        const intervalId = setInterval(
          async () => {
            await this.executeWithLock(job)
          },
          job.interval,
        )

        this.jobs.set(job.id, intervalId)
      }

      job.nextRun = Date.now() + job.interval
      await this.updateJobStats(job.id, { nextRun: job.nextRun })

      return job.id
    }

    if (job.type === 'one-time' && job.executeAt) {
      const delay = job.executeAt - Date.now()

      if (delay > 0) {
        const timeoutId = setTimeout(
          async () => {
            await this.executeWithLock(job)
            // Auto-cleanup one-time jobs
            await this.unschedule(job.id)
          },
          delay,
        )

        this.jobs.set(job.id, timeoutId)
        job.nextRun = job.executeAt
        await this.updateJobStats(job.id, { nextRun: job.nextRun })
      }
      else {
        // Immediate execution
        await this.executeWithLock(job)
      }

      return job.id
    }

    throw new Error(`Invalid job configuration: ${job.id}`)
  }

  /**
   * Execute job with distributed lock
   * Prevents multiple instances from running the same job
   */
  private async executeWithLock(job: ScheduledJob): Promise<void> {
    const lockAcquired = await this.acquireLock(job.id)

    if (!lockAcquired) {
      // Another instance is running this job
      return
    }

    try {
      // Set up lock renewal (for long-running jobs)
      this.startLockRenewal(job.id)

      // Execute the job
      await this.executeJob(job)
    }
    catch (error) {
      this.logger.error('Job failed', { jobId: job.id, error: (error as Error).message })
    }
    finally {
      // CRITICAL: Always clean up, even on error
      // Stop lock renewal and release lock
      this.stopLockRenewal(job.id)
      await this.releaseLock(job.id).catch((err) => {
        this.logger.error('Failed to release lock', { jobId: job.id, error: (err as Error).message })
      })
    }
  }

  private async executeJob(job: ScheduledJob): Promise<void> {
    const config = this.jobConfigs.get(job.id)
    if (!config) return

    try {
      const now = Date.now()
      config.lastRun = now
      config.runCount = (config.runCount || 0) + 1

      await job.handler()

      // Update next run for recurring jobs
      if (job.type === 'cron' && job.cron) {
        const cronJob = this.jobs.get(job.id)
        if (cronJob instanceof CronJob) {
          const nextDate = cronJob.nextDate()
          if (nextDate) {
            config.nextRun = nextDate.toMillis()
          }
        }
      }
      else if (job.type === 'interval' && job.interval) {
        config.nextRun = Date.now() + job.interval
      }

      await this.updateJobStats(job.id, {
        lastRun: now,
        nextRun: config.nextRun,
        runCount: config.runCount,
      })
    }
    catch (error) {
      config.failCount = (config.failCount || 0) + 1

      await this.updateJobStats(job.id, {
        failCount: config.failCount,
        lastError: error instanceof Error ? error.message : String(error),
      })

      throw error
    }
  }

  /**
   * Acquire distributed lock using store adapter
   */
  private async acquireLock(jobId: string): Promise<boolean> {
    const lockKey = `${this.keyPrefix}:lock:${jobId}`
    const now = Date.now()
    const expiresAt = now + this.lockTTL

    if (this.useIndexLocking && this.store.index.add) {
      // Use index-based locking (more robust, supports version control)
      try {
        const lockIndex = `${this.keyPrefix}:locks`

        await this.store.index.add(lockIndex, jobId, expiresAt, {
          instanceId: this.instanceId,
          acquiredAt: now,
          expiresAt,
        })

        return true
      }
      catch {
        // Lock already exists, check if expired
        if (this.store.index.get) {
          const existing = await this.store.index.get(`${this.keyPrefix}:locks`, jobId)

          if (existing && existing.score < now) {
            // Lock expired, delete and retry
            if (this.store.index.delete) {
              await this.store.index.delete(`${this.keyPrefix}:locks`, jobId)
              return this.acquireLock(jobId)
            }
          }
        }

        return false
      }
    }
    else {
      // Fallback to KV locking
      // WARNING: This is NOT atomic and has race conditions!
      // For production with file/memory stores, consider:
      // 1. Using Redis store instead (supports atomic operations)
      // 2. Or accepting that single-instance deployments don't need locking
      // 3. Or implementing file-based locking (flock)
      try {
        const existingLock = await this.store.kv.get<SchedulerLock>(lockKey)

        if (existingLock) {
          // Check if expired
          if (existingLock.expiresAt < now) {
            // Expired, delete and retry
            await this.store.kv.delete(lockKey)
            return this.acquireLock(jobId)
          }

          return false
        }

        const lock: SchedulerLock = {
          jobId,
          instanceId: this.instanceId,
          acquiredAt: now,
          expiresAt,
        }

        // NOTE: Race condition between get/set
        // Multiple instances can both see no lock and both set it
        // Acceptable for file/memory stores (typically single instance)
        await this.store.kv.set(lockKey, lock, Math.ceil(this.lockTTL / 1000))
        return true
      }
      catch (error) {
        this.logger.error('Error acquiring lock', { jobId, error: (error as Error).message })
        return false
      }
    }
  }

  /**
   * Release distributed lock
   */
  private async releaseLock(jobId: string): Promise<void> {
    if (this.useIndexLocking && this.store.index.delete) {
      const lockIndex = `${this.keyPrefix}:locks`
      await this.store.index.delete(lockIndex, jobId)
    }
    else {
      const lockKey = `${this.keyPrefix}:lock:${jobId}`
      await this.store.kv.delete(lockKey)
    }
  }

  /**
   * Start periodic lock renewal (for long-running jobs)
   */
  private startLockRenewal(jobId: string): void {
    // Renew lock at 50% of TTL
    const renewalInterval = this.lockTTL / 2

    const timer = setInterval(async () => {
      try {
        if (this.useIndexLocking && this.store.index.update) {
          const lockIndex = `${this.keyPrefix}:locks`
          const expiresAt = Date.now() + this.lockTTL

          await this.store.index.update(lockIndex, jobId, {
            expiresAt,
          })
        }
        else {
          // Renew KV lock
          const lockKey = `${this.keyPrefix}:lock:${jobId}`
          const lock = await this.store.kv.get<SchedulerLock>(lockKey)

          if (lock && lock.instanceId === this.instanceId) {
            lock.expiresAt = Date.now() + this.lockTTL
            await this.store.kv.set(lockKey, lock, Math.ceil(this.lockTTL / 1000))
          }
        }
      }
      catch (error) {
        this.logger.error('Error renewing lock', { jobId, error: (error as Error).message })
      }
    }, renewalInterval)

    this.lockRenewalTimers.set(jobId, timer)
  }

  /**
   * Stop lock renewal
   */
  private stopLockRenewal(jobId: string): void {
    const timer = this.lockRenewalTimers.get(jobId)
    if (timer) {
      clearInterval(timer)
      this.lockRenewalTimers.delete(jobId)
    }
  }

  /**
   * Persist job configuration
   */
  private async persistJob(job: ScheduledJob): Promise<void> {
    const jobKey = `${this.keyPrefix}:jobs:${job.id}`
    const now = Date.now()

    const jobData = {
      id: job.id,
      name: job.name,
      type: job.type,
      cron: job.cron,
      interval: job.interval,
      executeAt: job.executeAt,
      timezone: job.timezone || 'UTC',
      enabled: job.enabled !== false,
      metadata: job.metadata,
      persistedAt: now,
    }

    // Store in KV
    await this.store.kv.set(jobKey, jobData)

    // Also store in index for efficient recovery
    if (this.store.index.add) {
      try {
        const jobIndex = `${this.keyPrefix}:jobs`
        await this.store.index.add(jobIndex, job.id, now, jobData)
      }
      catch {
        // If job already exists in index, update it instead
        if (this.store.index.update) {
          try {
            const jobIndex = `${this.keyPrefix}:jobs`
            await this.store.index.update(jobIndex, job.id, jobData)
          }
          catch (updateError) {
            this.logger.error('Failed to persist job to index', { jobId: job.id, error: (updateError as Error).message })
          }
        }
      }
    }
  }

  /**
   * Update job statistics
   */
  private async updateJobStats(jobId: string, stats: Record<string, any>): Promise<void> {
    const statsKey = `${this.keyPrefix}:stats:${jobId}`

    try {
      const existing = await this.store.kv.get<any>(statsKey) || {}

      await this.store.kv.set(statsKey, {
        ...existing,
        ...stats,
      })
    }
    catch (error) {
      this.logger.error('Error updating stats', {
        jobId,
        error: (error as Error).message,
      })
    }
  }

  async unschedule(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId)

    if (job instanceof CronJob) {
      job.stop()
    }
    else if (job) {
      clearTimeout(job as NodeJS.Timeout)
      clearInterval(job as NodeJS.Timeout)
    }

    this.jobs.delete(jobId)
    this.jobConfigs.delete(jobId)

    // Clean up persisted data
    await this.store.kv.delete(`${this.keyPrefix}:jobs:${jobId}`)
    await this.store.kv.delete(`${this.keyPrefix}:stats:${jobId}`)

    // Remove from index if available
    if (this.store.index.delete) {
      try {
        await this.store.index.delete(`${this.keyPrefix}:jobs`, jobId)
      }
      catch {
        // Ignore - might not exist in index
      }
    }

    // Release lock if held
    await this.releaseLock(jobId)

    return !!job
  }

  /**
   * Recover jobs from store on startup
   * Critical for:
   * - Restarts: Re-create in-memory schedulers
   * - Horizontal scaling: New instances pick up existing jobs
   * - Orphaned awaits: Resume flows waiting on schedules
   */
  private async recoverJobs(): Promise<void> {
    this.logger.info('Recovering jobs from store')

    try {
      // Try to use index scan if available (more efficient)
      if (this.store.index.read) {
        const jobIndex = `${this.keyPrefix}:jobs`
        const jobEntries = await this.store.index.read(jobIndex, { limit: 10000 })

        this.logger.info('Found jobs in index', { count: jobEntries.length })

        for (const entry of jobEntries) {
          const jobData = entry.metadata as ScheduledJob
          if (jobData) {
            await this.recoverJob(jobData)
          }
        }
      }
      else {
        // Fallback: Scan KV keys (less efficient but works with file/memory stores)
        // Note: This requires listing all keys with prefix - not all stores support this efficiently
        // For file store, we need to list the directory - this is a limitation
        this.logger.warn('Store does not support index read. Job recovery limited.')
        this.logger.warn('For full job recovery, use Redis or Postgres store adapter.')

        // Try to recover known job patterns
        await this.recoverWellKnownJobs()
      }
    }
    catch (error) {
      this.logger.error('Error during job recovery', { error: (error as Error).message })
      // Don't throw - allow scheduler to start even if recovery fails
    }
  }

  /**
   * Recover a single job from persisted data
   *
   * IMPORTANT: This method reconstructs in-memory schedulers (CronJob/setInterval)
   * WITHOUT calling schedule() to avoid re-persisting handler functions (which
   * cannot be serialized). Handlers are reconstructed from metadata where possible.
   */
  private async recoverJob(jobData: ScheduledJob): Promise<void> {
    try {
      // Check if job is already scheduled (avoid duplicates)
      if (this.jobs.has(jobData.id)) {
        return
      }

      // Skip if job is explicitly disabled (paused triggers)
      if (jobData.enabled === false) {
        this.logger.debug('Skipping disabled job', { jobId: jobData.id })
        return
      }

      // Check if this is a schedule trigger job that needs handler reconstruction
      if (jobData.metadata?.type === 'schedule-trigger' && jobData.metadata?.triggerName) {
        // Reconstruct handler from metadata
        jobData.handler = async () => {
          const logger = useNventLogger('scheduler')
          const eventBus = getEventBus()
          const triggerName = jobData.metadata?.triggerName
          const scheduleConfig = jobData.metadata?.scheduleConfig

          logger.debug('Schedule trigger fired', { trigger: triggerName })

          // Publish trigger.fired event
          await eventBus.publish({
            type: 'trigger.fired',
            triggerName,
            data: {
              scheduledAt: Date.now(),
              timezone: scheduleConfig?.timezone || 'UTC',
            },
          } as any)
        }
      }
      else if (jobData.metadata?.component === 'await-pattern') {
        // Reconstruct await pattern handler from metadata
        const { awaitType, runId, stepName, flowName, position } = jobData.metadata

        if (awaitType === 'time') {
          // Time await resolver
          jobData.handler = async () => {
            await resolveTimeAwait(runId, stepName, flowName, position, { delayCompleted: true })
          }
        }
        else if (awaitType === 'schedule') {
          // Schedule await resolver
          jobData.handler = async () => {
            await resolveScheduleAwait(runId, stepName, flowName, position, { scheduledAt: Date.now() })
          }
        }
        else if (awaitType === 'webhook') {
          // Webhook timeout handler
          jobData.handler = async () => {
            const eventBus = getEventBus()
            const timeout = jobData.metadata?.timeout
            const timeoutAction = jobData.metadata?.timeoutAction || 'fail'

            this.logger.warn('Webhook await timeout', {
              runId,
              stepName,
              flowName,
              timeout,
              timeoutAction,
            })

            eventBus.publish({
              type: 'await.timeout',
              flowName,
              runId,
              stepName,
              position,
              awaitType: 'webhook',
              timeoutAction,
              data: {
                timeout,
                registeredAt: Date.now() - (timeout || 0),
                timedOutAt: Date.now(),
              },
            } as any)
          }
        }
        else if (awaitType === 'event') {
          // Event await timeout handler
          jobData.handler = async () => {
            const eventBus = getEventBus()
            const timeout = jobData.metadata?.timeout
            const timeoutAction = jobData.metadata?.timeoutAction || 'fail'
            const eventName = jobData.metadata?.eventName

            this.logger.warn('Event await timeout', {
              runId,
              stepName,
              flowName,
              eventName,
              timeout,
              timeoutAction,
            })

            eventBus.publish({
              type: 'await.timeout',
              flowName,
              runId,
              stepName,
              position,
              awaitType: 'event',
              timeoutAction,
              data: {
                eventName,
                timeout,
                registeredAt: Date.now() - (timeout || 0),
                timedOutAt: Date.now(),
              },
            } as any)
          }
        }
        else {
          this.logger.warn('Cannot reconstruct await pattern', { awaitType, jobId: jobData.id })
          return
        }

        this.logger.info('Reconstructed await pattern handler', {
          awaitType,
          flowName,
          runId,
        })
      }
      else if (!jobData.handler) {
        // Job has no handler and can't be reconstructed
        // Keep it in storage - the component that created it will re-register with handler
        // For horizontal scaling, this allows other instances to take over
        this.logger.debug('Skipping job - no handler available, waiting for re-registration', {
          jobId: jobData.id,
        })
        return
      }

      // Store job config in memory
      this.jobConfigs.set(jobData.id, jobData)

      // Re-create the in-memory scheduler (cron/interval) WITHOUT persisting again
      // The job is already persisted, we just need to recreate the runtime execution
      if (jobData.type === 'cron' && jobData.cron) {
        const cronJob = new CronJob(
          jobData.cron,
          async () => {
            await this.executeWithLock(jobData)
          },
          null,
          true, // Start immediately since scheduler.started is already true
          jobData.timezone || 'UTC',
        )

        this.jobs.set(jobData.id, cronJob)
        this.logger.info('Recovered cron job', { jobId: jobData.id })
      }
      else if (jobData.type === 'interval' && jobData.interval) {
        const intervalId = setInterval(
          async () => {
            await this.executeWithLock(jobData)
          },
          jobData.interval,
        )

        this.jobs.set(jobData.id, intervalId)
        this.logger.info('Recovered interval job', { jobId: jobData.id })
      }
      else if (jobData.type === 'one-time' && jobData.executeAt) {
        const delay = jobData.executeAt - Date.now()
        const isAwaitPattern = jobData.metadata?.component === 'await-pattern'

        if (delay > 0) {
          const timeoutId = setTimeout(
            async () => {
              await this.executeWithLock(jobData)
              await this.unschedule(jobData.id)
            },
            delay,
          )

          this.jobs.set(jobData.id, timeoutId)
          this.logger.info('Recovered one-time job', { jobId: jobData.id })
        }
        else if (isAwaitPattern) {
          // Await patterns that expired during downtime should execute immediately
          // The flow has been waiting and needs to continue
          this.logger.info('Executing overdue await pattern immediately', {
            jobId: jobData.id,
            awaitType: jobData.metadata?.awaitType,
            flowName: jobData.metadata?.flowName,
          })

          // Execute immediately without lock (already waited long enough)
          setImmediate(async () => {
            try {
              await jobData.handler()
              await this.unschedule(jobData.id)
            }
            catch (error) {
              this.logger.error('Failed to execute overdue await pattern', {
                jobId: jobData.id,
                error: (error as Error).message,
              })
            }
          })
        }
        else {
          this.logger.debug('Skipping expired one-time job', { jobId: jobData.id })
        }
      }
    }
    catch (error) {
      this.logger.error('Failed to recover job', {
        jobId: jobData.id,
        error: (error as Error).message,
      })
    }
  }

  /**
   * Recover well-known job patterns when index scan is not available
   * This includes:
   * - stall-detection (always exists)
   * - await-time-* (flows waiting on time delays)
   * - await-schedule-* (flows waiting on cron schedules)
   */
  private async recoverWellKnownJobs(): Promise<void> {
    const knownPatterns = [
      'stall-detection',
      // Note: await-* jobs have dynamic IDs, we can't easily recover them without scanning
      // This is a limitation of KV-only stores
    ]

    for (const jobId of knownPatterns) {
      try {
        const jobKey = `${this.keyPrefix}:jobs:${jobId}`
        const jobData = await this.store.kv.get<ScheduledJob>(jobKey)

        if (jobData) {
          await this.recoverJob(jobData)
        }
      }
      catch {
        // Ignore - job might not exist
      }
    }

    this.logger.info('Recovered well-known jobs. Await patterns may need manual recovery.')
  }

  async start(): Promise<void> {
    if (this.started) return

    // Set started flag BEFORE recovery so that recovered jobs are created in started state
    this.started = true

    // CRITICAL: Recover persisted jobs (they will be created in started state)
    await this.recoverJobs()

    this.logger.info('Started with active jobs', { count: this.jobs.size })
  }

  async stop(): Promise<void> {
    this.started = false

    // Stop all jobs
    for (const job of this.jobs.values()) {
      if (job instanceof CronJob) {
        job.stop()
      }
      else {
        clearTimeout(job as NodeJS.Timeout)
        clearInterval(job as NodeJS.Timeout)
      }
    }

    // Stop all lock renewals
    for (const timer of this.lockRenewalTimers.values()) {
      clearInterval(timer)
    }
    this.lockRenewalTimers.clear()

    // Release all locks held by this instance
    if (this.useIndexLocking && this.store.index.read) {
      const lockIndex = `${this.keyPrefix}:locks`
      const locks = await this.store.index.read(lockIndex, { limit: 1000 })

      for (const lock of locks) {
        if (lock.metadata?.instanceId === this.instanceId) {
          await this.releaseLock(lock.id)
        }
      }
    }

    this.jobs.clear()
    this.jobConfigs.clear()
  }

  async getScheduledJobs(): Promise<ScheduledJob[]> {
    return Array.from(this.jobConfigs.values())
  }

  /**
   * Get all persisted jobs from store (for debugging/monitoring)
   * This shows ALL jobs across ALL instances with their runtime stats
   */
  async getAllPersistedJobs(): Promise<ScheduledJob[]> {
    const jobs: ScheduledJob[] = []

    try {
      if (this.store.index.read) {
        const jobIndex = `${this.keyPrefix}:jobs`
        const entries = await this.store.index.read(jobIndex, { limit: 10000 })

        for (const entry of entries) {
          if (entry.metadata) {
            const jobConfig = entry.metadata as ScheduledJob

            // Fetch runtime stats for this job
            const statsKey = `${this.keyPrefix}:stats:${jobConfig.id}`
            try {
              const stats = await this.store.kv.get<any>(statsKey)
              if (stats) {
                // Merge stats with job config
                jobs.push({
                  ...jobConfig,
                  lastRun: stats.lastRun,
                  nextRun: stats.nextRun,
                  runCount: stats.runCount,
                  failCount: stats.failCount,
                })
              }
              else {
                // No stats yet, just push config
                jobs.push(jobConfig)
              }
            }
            catch {
              // Stats read failed, push without stats
              jobs.push(jobConfig)
            }
          }
        }
      }
      else {
        this.logger.warn('Cannot list all persisted jobs without index support')
      }
    }
    catch (error) {
      this.logger.error('Error getting persisted jobs', { error: (error as Error).message })
    }

    return jobs
  }

  async isHealthy(): Promise<boolean> {
    // Check if store is accessible
    try {
      await this.store.kv.get('__health_check__')
      return true
    }
    catch {
      return false
    }
  }
}
