/**
 * PostgreSQL Queue Adapter for nvent
 *
 * Uses pg-boss for PostgreSQL-based job queue
 * Modeled after the Redis adapter implementation
 */

import { PgBoss } from 'pg-boss'
import type { Job as PgBossJob } from 'pg-boss'
import { Pool } from 'pg'
import type { Pool as PgPool } from 'pg'
import { defineNitroPlugin } from 'nitropack/runtime'
import { useRuntimeConfig, registerQueueAdapter, useNventLogger } from '#imports'
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

export interface PostgresQueueAdapterOptions {
  connection?: {
    host?: string
    port?: number
    database?: string
    user?: string
    password?: string
    connectionString?: string
    ssl?: boolean | object
    max?: number // max connections in pool
  }
  schema?: string // default: 'pgboss'
  archiveCompletedAfterSeconds?: number
  deleteAfterDays?: number
  retryLimit?: number
  retryDelay?: number
  retryBackoff?: boolean
  expireInSeconds?: number
  retentionDays?: number
  maintenanceIntervalSeconds?: number
}

interface QueueCache {
  boss: PgBoss
  handlers: Map<string, WorkerHandler>
  subscribed: Set<string>
  concurrency: number
  workerStarted: boolean
}

export class PostgresQueueAdapter implements QueueAdapter {
  private queues = new Map<string, QueueCache>()
  private boss: PgBoss | null = null
  private pgPool: PgPool | null = null
  private options: PostgresQueueAdapterOptions
  private eventListeners = new Map<string, Array<(payload: any) => void>>()
  private initialized = false
  private logger = useNventLogger('adapter-queue-postgres')

  constructor(options: PostgresQueueAdapterOptions = {}) {
    this.options = options
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return
    }

    const connection = this.options.connection

    if (!connection) {
      throw new Error('[PostgresQueueAdapter] No connection configuration provided')
    }

    // Build pg-boss options
    const bossOptions: any = {
      // Connection
      host: connection.host || 'localhost',
      port: connection.port || 5432,
      database: connection.database,
      user: connection.user,
      password: connection.password,
      connectionString: connection.connectionString,
      ssl: connection.ssl,
      max: connection.max || 10,

      // Schema
      schema: this.options.schema || 'pgboss',

      // Archive and retention
      archiveCompletedAfterSeconds: this.options.archiveCompletedAfterSeconds,
      deleteAfterDays: this.options.deleteAfterDays || 7,
      retentionDays: this.options.retentionDays,

      // Maintenance
      maintenanceIntervalSeconds: this.options.maintenanceIntervalSeconds || 120,

      // Performance tuning for faster job processing
      newJobCheckInterval: 500, // Check for new jobs every 500ms (default: 2000ms)
      newJobCheckIntervalSeconds: 0.5, // Alternative name for same setting
    }

    // Remove undefined values by creating a new object
    const cleanOptions = Object.fromEntries(
      Object.entries(bossOptions).filter(([_, v]) => v !== undefined),
    )

    try {
      this.boss = new PgBoss(cleanOptions)
      await this.boss.start()

      // Create separate pg Pool for direct database queries
      // pg-boss doesn't expose a public query API, so we need our own pool
      this.pgPool = new Pool({
        host: connection.host || 'localhost',
        port: connection.port || 5432,
        database: connection.database,
        user: connection.user,
        password: connection.password,
        connectionString: connection.connectionString,
        ssl: connection.ssl,
        max: connection.max || 10,
      })

      this.initialized = true
      this.logger.info('Initialized successfully')
    }
    catch (error) {
      this.logger.error('Failed to initialize:', error)
      throw error
    }
  }

  private ensureQueue(name: string): QueueCache {
    if (!this.boss) {
      throw new Error('[PostgresQueueAdapter] Adapter not initialized. Call init() first.')
    }

    let cached = this.queues.get(name)
    if (cached) {
      return cached
    }

    cached = {
      boss: this.boss,
      handlers: new Map<string, WorkerHandler>(),
      subscribed: new Set<string>(),
      concurrency: 1, // Default concurrency
      workerStarted: false,
    }

    this.queues.set(name, cached)

    return cached
  }

  async enqueue(queueName: string, job: JobInput): Promise<string> {
    const { boss } = this.ensureQueue(queueName)

    // pg-boss singletonKey prevents duplicate QUEUED jobs, but not ACTIVE jobs
    // Once a job starts processing, you can queue another with the same singletonKey
    // This causes issues with retries because flow wiring tries to re-enqueue on every event
    //
    // Solution: Use useSingletonQueue option which ensures only ONE job with this key
    // exists across ALL states (created, active, retry, failed) until completed
    // This is similar to how BullMQ prevents duplicate job IDs

    // Build job options for pg-boss
    // NOTE: pg-boss retryLimit is number of RETRIES, not total attempts
    // So attempts=3 means 1 initial + 2 retries, which is retryLimit=2
    const attempts = job.opts?.attempts || this.options.retryLimit || 3
    // pg-boss retryDelay is in SECONDS, but backoff.delay from BullMQ is in milliseconds
    const retryDelayMs = job.opts?.backoff?.delay || this.options.retryDelay || 1000
    const retryDelaySeconds = Math.max(1, Math.floor(retryDelayMs / 1000)) // Minimum 1 second
    const jobOptions: any = {
      retryLimit: Math.max(0, attempts - 1), // Convert attempts to retries
      retryDelay: retryDelaySeconds, // Convert ms to seconds (minimum 1s)
      retryBackoff: job.opts?.backoff?.type === 'exponential' || this.options.retryBackoff,
      expireInSeconds: job.opts?.timeout ? Math.floor(job.opts.timeout / 1000) : this.options.expireInSeconds,
      priority: job.opts?.priority,
    }

    // Handle delayed jobs
    if (job.opts?.delay) {
      jobOptions.startAfter = job.opts.delay
    }

    // Handle custom jobId for idempotency using singletonKey
    // pg-boss singletonKey prevents duplicate jobs with the same key
    // With useSingletonQueue: check across all states (not just created/retry)
    // With singletonSeconds: defines how long the singleton constraint lasts
    // Setting singletonSeconds to a large value (e.g., 1 hour) prevents re-enqueueing
    // during the entire job lifecycle including retries
    if (job.opts?.jobId) {
      jobOptions.singletonKey = job.opts.jobId
      jobOptions.useSingletonQueue = true
      // Keep singleton constraint for 1 hour (prevents re-enqueue during retries)
      jobOptions.singletonSeconds = 3600
    }

    // Remove undefined values by creating a new object
    const cleanJobOptions = Object.fromEntries(
      Object.entries(jobOptions).filter(([_, v]) => v !== undefined),
    )

    // Store job name in data for dispatcher to route correctly
    const jobData = {
      __jobName: job.name, // Internal field for dispatcher
      ...job.data,
    }

    const jobId = await boss.send(queueName, jobData, cleanJobOptions)

    if (!jobId) {
      // pg-boss returns null when singletonKey is used and a job with that key already exists
      // This is expected behavior for idempotency - job is already queued/active
      if (job.opts?.jobId) {
        // Return the singletonKey as the job ID for tracking
        return job.opts.jobId
      }

      // If no singletonKey was used, this is an actual error
      throw new Error(`Failed to enqueue job ${job.name} to queue ${queueName}`)
    }

    // Emit waiting event
    this.emitEvent(queueName, 'waiting', { jobId, job: { id: jobId, name: job.name, data: job.data } })

    return jobId
  }

  async schedule(queueName: string, job: JobInput, opts?: ScheduleOptions): Promise<string> {
    const { boss } = this.ensureQueue(queueName)

    // Convert attempts to retryLimit (same as enqueue)
    const attempts = job.opts?.attempts || this.options.retryLimit || 3
    const retryDelayMs = job.opts?.backoff?.delay || this.options.retryDelay || 0

    const jobOptions: any = {
      retryLimit: Math.max(0, attempts - 1), // Convert attempts to retries
      retryDelay: Math.floor(retryDelayMs / 1000), // Convert ms to seconds
      retryBackoff: job.opts?.backoff?.type === 'exponential' || this.options.retryBackoff,
      expireInSeconds: job.opts?.timeout ? Math.floor(job.opts.timeout / 1000) : this.options.expireInSeconds,
      priority: job.opts?.priority,
    }

    // Handle delay
    if (opts?.delay) {
      jobOptions.startAfter = opts.delay
    }

    // Store job name in data for dispatcher
    const jobData = {
      __jobName: job.name,
      ...job.data,
    }

    // Handle cron scheduling
    if (opts?.cron || opts?.repeat?.pattern) {
      const cronPattern = opts.cron || opts.repeat?.pattern

      // Remove undefined values by creating a new object
      const cleanJobOptions = Object.fromEntries(
        Object.entries(jobOptions).filter(([_, v]) => v !== undefined),
      )

      await boss.schedule(queueName, cronPattern!, jobData, cleanJobOptions)

      // pg-boss schedule returns void, use queue name + job name as schedule ID
      return `${queueName}.${job.name}`
    }

    // Remove undefined values by creating a new object
    const cleanJobOptions = Object.fromEntries(
      Object.entries(jobOptions).filter(([_, v]) => v !== undefined),
    )

    // Regular delayed job
    const jobId = await boss.send(queueName, jobData, cleanJobOptions)

    if (!jobId) {
      throw new Error(`Failed to schedule job ${job.name} on queue ${queueName}`)
    }

    // Emit delayed event if there's a delay
    if (opts?.delay) {
      this.emitEvent(queueName, 'delayed', { jobId, job: { id: jobId, name: job.name, data: job.data } })
    }

    return jobId
  }

  async getJob(queueName: string, id: string): Promise<Job | null> {
    const { boss } = this.ensureQueue(queueName)

    try {
      // With dispatcher pattern, use getJobById with the queue name directly
      const job = await boss.getJobById(queueName, id)
      if (job) {
        return this.toJob(job as any)
      }
      return null
    }
    catch (error) {
      this.logger.error(`Error getting job ${id}:`, error)
      return null
    }
  }

  async getJobs(queueName: string, query?: JobsQuery): Promise<Job[]> {
    if (!this.pgPool) {
      return []
    }

    try {
      this.ensureQueue(queueName)

      // Map our state query to pg-boss states
      let stateFilter: string[] | undefined
      if (query?.state && query.state.length > 0) {
        stateFilter = query.state.map((state) => {
          if (state === 'waiting') return 'created'
          if (state === 'delayed') return 'retry'
          return state
        })
      }

      // Build SQL query to fetch jobs from this queue
      const schema = this.options.schema || 'pgboss'
      const limit = query?.limit || 1000
      const offset = query?.offset || 0

      // Build WHERE clause
      const conditions = [`name = $1`]
      const values: any[] = [queueName]

      if (stateFilter && stateFilter.length > 0) {
        conditions.push(`state = ANY($${values.length + 1}::text[])`)
        values.push(stateFilter)
      }

      const whereClause = conditions.join(' AND ')

      // Use our own pg Pool for queries
      const result = await this.pgPool.query(
        `SELECT * FROM ${schema}.job
         WHERE ${whereClause}
         ORDER BY created_on DESC
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, limit, offset],
      )

      if (!result || !result.rows) {
        return []
      }

      return result.rows.map((row: any) => this.toJob(row))
    }
    catch (error) {
      this.logger.error('Error fetching jobs:', error)
      return []
    }
  }

  on(queueName: string, event: QueueEvent, cb: (p: any) => void): () => void {
    const key = `${queueName}:${event}`

    if (!this.eventListeners.has(key)) {
      this.eventListeners.set(key, [])
    }

    this.eventListeners.get(key)!.push(cb)

    return () => {
      const listeners = this.eventListeners.get(key)
      if (listeners) {
        const index = listeners.indexOf(cb)
        if (index > -1) {
          listeners.splice(index, 1)
        }
      }
    }
  }

  async isPaused(_queueName: string): Promise<boolean> {
    // pg-boss doesn't have a direct pause/resume mechanism per queue
    // This would need to be tracked separately
    return false
  }

  async getJobCounts(queueName: string): Promise<JobCounts> {
    if (!this.pgPool) {
      return {
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        waiting: 0,
        paused: 0,
      }
    }

    try {
      const schema = this.options.schema || 'pgboss'

      // Query job counts directly from the job table
      // This is more reliable than using getQueueStats which may not work for all queues
      const result = await this.pgPool.query(
        `SELECT 
          COUNT(*) FILTER (WHERE state = 'created') as waiting,
          COUNT(*) FILTER (WHERE state = 'retry') as delayed,
          COUNT(*) FILTER (WHERE state = 'active') as active,
          COUNT(*) FILTER (WHERE state = 'completed') as completed,
          COUNT(*) FILTER (WHERE state = 'failed') as failed
         FROM ${schema}.job
         WHERE name = $1`,
        [queueName],
      )

      let waiting = 0
      let delayed = 0
      let active = 0
      let completed = 0
      let failed = 0

      if (result?.rows?.[0]) {
        waiting = Number.parseInt(result.rows[0].waiting) || 0
        delayed = Number.parseInt(result.rows[0].delayed) || 0
        active = Number.parseInt(result.rows[0].active) || 0
        completed = Number.parseInt(result.rows[0].completed) || 0
        failed = Number.parseInt(result.rows[0].failed) || 0
      }

      // Also check archive table for completed/failed jobs that may have been archived
      try {
        const archiveResult = await this.pgPool.query(
          `SELECT 
            COUNT(*) FILTER (WHERE state = 'completed') as completed,
            COUNT(*) FILTER (WHERE state = 'failed') as failed
           FROM ${schema}.archive
           WHERE name = $1`,
          [queueName],
        )

        if (archiveResult?.rows?.[0]) {
          completed += Number.parseInt(archiveResult.rows[0].completed) || 0
          failed += Number.parseInt(archiveResult.rows[0].failed) || 0
        }
      }
      catch (error: any) {
        // Archive table may not exist yet, that's okay
        if (!error.message?.includes('does not exist')) {
          this.logger.warn('Error querying archive table:', error)
        }
      }

      return {
        waiting,
        delayed,
        active,
        completed,
        failed,
        paused: 0, // pg-boss doesn't have paused state
      }
    }
    catch (error) {
      this.logger.error('Error getting job counts:', error)
      return {
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        waiting: 0,
        paused: 0,
      }
    }
  }

  async getScheduledJobs(queueName: string): Promise<Array<any>> {
    const { boss } = this.ensureQueue(queueName)

    try {
      // Get all schedules from pg-boss
      const schedules = await boss.getSchedules()

      // Filter by queue name (with dispatcher pattern, schedule name matches queueName)
      const filtered = schedules.filter((s: any) => s.name === queueName)

      return filtered.map((schedule: any) => ({
        id: schedule.name, // pg-boss uses name as ID for schedules
        jobName: schedule.name, // With dispatcher, name is the queue name
        queueName,
        cron: schedule.cron,
        pattern: schedule.cron,
        nextRun: schedule.created ? new Date(schedule.created) : undefined,
        repeatCount: undefined,
        limit: undefined,
      }))
    }
    catch (error) {
      this.logger.error('Error getting scheduled jobs:', error)
      return []
    }
  }

  async removeScheduledJob(scheduleId: string): Promise<boolean> {
    if (!this.boss) {
      return false
    }

    try {
      // In pg-boss, scheduleId is the job name
      await this.boss.unschedule(scheduleId)
      this.logger.info(`Removed scheduled job: ${scheduleId}`)
      return true
    }
    catch (error) {
      this.logger.error(`Error removing scheduled job ${scheduleId}:`, error)
      return false
    }
  }

  async pause(_queueName: string): Promise<void> {
    // pg-boss doesn't have a built-in pause mechanism
    // Would need to track this state and skip work() calls
    this.logger.warn('pause() not implemented - pg-boss does not support queue pausing')
  }

  async resume(_queueName: string): Promise<void> {
    // pg-boss doesn't have a built-in resume mechanism
    this.logger.warn('resume() not implemented - pg-boss does not support queue resuming')
  }

  registerWorker(
    queueName: string,
    jobName: string,
    handler: WorkerHandler,
    opts?: WorkerOptions,
  ): void {
    const queueCache = this.ensureQueue(queueName)

    // Add handler to the handlers map (dispatcher pattern like BullMQ)
    queueCache.handlers.set(jobName, handler)

    const requestedConcurrency = opts?.concurrency || 1

    // Update queue concurrency to the maximum requested by any handler
    if (requestedConcurrency > queueCache.concurrency) {
      queueCache.concurrency = requestedConcurrency
    }

    // Don't start worker yet - defer until startProcessingQueue is called
    // This allows all handlers to register and we use the maximum concurrency
  }

  startProcessingQueue(queueName: string): void {
    const queueCache = this.queues.get(queueName)
    if (!queueCache) {
      this.logger.warn(`Cannot start processing queue "${queueName}" - queue not found`)
      return
    }

    if (queueCache.workerStarted) {
      return
    }

    queueCache.workerStarted = true
    queueCache.subscribed.add(queueName)

    const concurrency = queueCache.concurrency

    // pg-boss concurrency pattern: Call work() N times to create N workers
    // Each worker fetches and processes jobs independently
    //
    // Note: Using batchSize > 1 with work() doesn't provide true concurrency because:
    // - Handler runs sequentially on the batch
    // - All jobs in batch share the same completion status (all succeed or all fail)
    // - To process jobs concurrently AND independently, we need separate workers
    const workOptions: any = {
      batchSize: 1, // Fetch 1 job per worker for independent success/failure tracking
      includeMetadata: true, // Required for retryLimit and retryCount
    }

    // Dispatcher routes to correct handler by job name (stored in data.__jobName)
    const processJobInternal = async (job: PgBossJob) => {
      // Extract job name from data
      const jobNameFromData = (job.data as any)?.__jobName
      if (!jobNameFromData) {
        const error = `Job ${job.id} missing __jobName in data`
        this.logger.error(error)
        throw new Error(error)
      }

      // Get the handler for this job type from the handlers map
      const jobHandler = queueCache.handlers.get(jobNameFromData)
      if (!jobHandler) {
        const error = `No handler for job "${jobNameFromData}" on queue "${queueName}". `
          + `Available: ${Array.from(queueCache.handlers.keys()).join(', ')}`
        this.logger.error(error)
        throw new Error(error)
      }

      try {
        // Emit active event
        this.emitEvent(queueName, 'active', { jobId: job.id, job })

        // With includeMetadata: true, pg-boss returns JobWithMetadata which has retryLimit and retryCount
        const metadata = job as any

        // Create job options from pg-boss metadata
        // NOTE: pg-boss retryLimit is number of RETRIES, so total attempts = retryLimit + 1
        const retryLimit = metadata.retryLimit ?? this.options.retryLimit ?? 3
        const jobOpts = {
          attempts: retryLimit + 1, // Convert retries to total attempts
          backoff: {
            delay: metadata.retryDelay || this.options.retryDelay,
            type: metadata.retryBackoff ? 'exponential' : 'fixed',
          },
        }

        // Remove __jobName from data before passing to handler
        const { __jobName, ...cleanData } = job.data as any

        // Create a job object that matches what handlers expect
        // Map pg-boss JobWithMetadata to BullMQ-like structure
        const jobForHandler = {
          id: job.id,
          data: cleanData,
          attemptsMade: metadata.retryCount || 0, // pg-boss uses retryCount (0-indexed)
          opts: jobOpts,
          name: jobNameFromData, // Use job name from data
        }

        // Execute handler - createJobProcessor wraps handlers and expects job object as first arg
        // The second arg (context) is not used by the wrapped processor (it builds context internally)
        const result = await jobHandler(jobForHandler as any, {} as any)

        // Emit completed event
        this.emitEvent(queueName, 'completed', { jobId: job.id, returnvalue: result })

        // Return result - pg-boss will automatically complete the job
        return result
      }
      catch (error) {
        const metadata = job as any

        this.logger.warn(`Job ${job.id} failed (attempt ${metadata.retryCount + 1}/${metadata.retryLimit + 1}):`, {
          error: (error as Error).message,
          willRetry: metadata.retryCount < metadata.retryLimit,
        })

        // Emit failed event
        this.emitEvent(queueName, 'failed', {
          jobId: job.id,
          failedReason: (error as Error).message,
          error,
        })

        // Re-throw error - pg-boss will mark job as failed and handle retries automatically
        throw error
      }
    }

    const workerHandler = async (jobs: PgBossJob[]) => {
      if (!jobs || jobs.length === 0) {
        this.logger.warn('Worker handler called with empty jobs array')
        return
      }

      // pg-boss work() handlers: batchSize is for FETCHING multiple jobs at once
      // but each job is processed individually. Handler should process THE FIRST JOB
      // in the array and return/throw based on that job's outcome.
      // pg-boss will call the handler multiple times if batchSize > 1.
      //
      // Actually, after reading docs: with batchSize > 1, handler receives array
      // and return/throw affects ALL jobs. For independent completion, use batchSize: 1
      // OR handle jobs individually (which we do via teamConcurrency).
      const job = jobs[0]
      if (!job) {
        return
      }

      // Process single job - return value completes it, throw fails it
      const result = await processJobInternal(job)
      return result
    }

    // Create queue and subscribe to the queue (not individual job types)
    // pg-boss requires the queue to exist before workers can subscribe
    // To achieve concurrency, call work() multiple times - each creates one worker
    queueCache.boss.createQueue(queueName)
      .then(async () => {
        // Create N workers for parallel processing (matching BullMQ concurrency)
        const workerPromises = []
        for (let i = 0; i < concurrency; i++) {
          workerPromises.push(
            queueCache.boss.work(queueName, workOptions as any, workerHandler as any),
          )
        }
        await Promise.all(workerPromises)
      })
      .then(() => {
        this.logger.info(`Started ${concurrency} worker(s) for queue "${queueName}"`)
      })
      .catch((error: any) => {
        this.logger.error(`Failed to create worker for ${queueName}:`, error)
        queueCache.subscribed.delete(queueName) // Remove from subscribed on error
      })
  }

  async close(): Promise<void> {
    if (this.boss) {
      try {
        await this.boss.stop()
        this.logger.info('Stopped successfully')
      }
      catch (error) {
        this.logger.error('Error stopping:', error)
      }
      this.boss = null
    }

    if (this.pgPool) {
      try {
        await this.pgPool.end()
      }
      catch (error) {
        this.logger.error('Error closing pg pool:', error)
      }
      this.pgPool = null
    }

    this.queues.clear()
    this.eventListeners.clear()
    this.initialized = false
  }

  private toJob(j: PgBossJob): Job {
    // Cast to any to access pg-boss specific properties
    const pgJob = j as any

    // Map pg-boss job states to our Job interface states
    let state: Job['state'] = 'waiting'
    const jobState = pgJob.state || 'created'
    if (jobState === 'created') state = 'waiting'
    else if (jobState === 'active') state = 'active'
    else if (jobState === 'completed') state = 'completed'
    else if (jobState === 'failed' || jobState === 'expired') state = 'failed'
    else if (jobState === 'retry') state = 'delayed'
    else if (jobState === 'cancelled') state = 'failed'

    // Extract the actual job name from data (dispatcher stores it in __jobName)
    const jobData = (j.data || pgJob.data) as any
    const actualJobName = jobData?.__jobName || j.name || pgJob.name

    // Remove __jobName from data when returning job
    const { __jobName, ...cleanData } = jobData || {}

    return {
      id: j.id || pgJob.id,
      name: actualJobName, // Use the actual job name, not the queue name
      data: cleanData, // Return data without __jobName
      returnvalue: pgJob.output,
      failedReason: pgJob.error?.message || (pgJob.output && pgJob.output.message),
      state,
      timestamp: pgJob.created_on ? new Date(pgJob.created_on).getTime() : Date.now(),
      processedOn: pgJob.started_on ? new Date(pgJob.started_on).getTime() : undefined,
      finishedOn: pgJob.completed_on ? new Date(pgJob.completed_on).getTime() : undefined,
      attemptsMade: pgJob.retry_count || 0,
      progress: undefined,
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
        this.logger.error(`Error in event listener for ${key}:`, error)
      }
    }
  }
}

// Nitro plugin to register this adapter via hook
export default defineNitroPlugin(async (nitroApp) => {
  // Listen to the registration hook from nvent
  nitroApp.hooks.hook('nvent:register-adapters' as any, () => {
    const runtimeConfig = useRuntimeConfig()
    const moduleOptions = (runtimeConfig as any).nventQueuePostgres || {}
    const nventConfig = (runtimeConfig as any).nvent || {}

    // Get connection from module options, nvent config, or connections config
    const connection = moduleOptions.connection
      || nventConfig.queue?.connection
      || nventConfig.connections?.postgres

    const logger = useNventLogger('adapter-queue-postgres')

    if (!connection) {
      logger.warn('No PostgreSQL connection config found')
    }

    const config = defu(moduleOptions, {
      connection,
      schema: nventConfig.queue?.schema || 'pgboss',
      retryLimit: nventConfig.queue?.retryLimit,
      retryDelay: nventConfig.queue?.retryDelay,
      retryBackoff: nventConfig.queue?.retryBackoff,
    })

    // Create and register adapter
    const adapter = new PostgresQueueAdapter({
      connection: config.connection,
      schema: config.schema,
      archiveCompletedAfterSeconds: config.archiveCompletedAfterSeconds,
      deleteAfterDays: config.deleteAfterDays,
      retryLimit: config.retryLimit,
      retryDelay: config.retryDelay,
      retryBackoff: config.retryBackoff,
      expireInSeconds: config.expireInSeconds,
      retentionDays: config.retentionDays,
      maintenanceIntervalSeconds: config.maintenanceIntervalSeconds,
    })

    registerQueueAdapter('postgres', adapter)

    logger.info('PostgreSQL queue adapter registered')
  })
})
