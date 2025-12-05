/**
 * Scheduler Types
 *
 * Unified scheduling system for all time-based operations in nvent:
 * - Stall detection
 * - Await timeouts
 * - Trigger schedules
 * - Cleanup jobs
 */

export interface ScheduledJob {
  /**
   * Unique job identifier
   */
  id: string

  /**
   * Human-readable job name
   */
  name: string

  /**
   * Job type
   */
  type: 'cron' | 'interval' | 'one-time'

  /**
   * Cron expression (for type: 'cron')
   * @example '0 2 * * *' - Daily at 2 AM
   * @example '* /5 * * * *' - Every 5 minutes
   */
  cron?: string

  /**
   * Interval in milliseconds (for type: 'interval')
   */
  interval?: number

  /**
   * Execution timestamp (for type: 'one-time')
   */
  executeAt?: number

  /**
   * Job handler function
   */
  handler: () => Promise<void>

  /**
   * Timezone for cron jobs
   * @default 'UTC'
   */
  timezone?: string

  /**
   * Whether the job is enabled
   * @default true
   */
  enabled?: boolean

  /**
   * Additional metadata
   */
  metadata?: Record<string, any>

  /**
   * Last execution timestamp
   */
  lastRun?: number

  /**
   * Next scheduled execution timestamp
   */
  nextRun?: number

  /**
   * Total execution count
   */
  runCount?: number

  /**
   * Failure count
   */
  failCount?: number
}

export interface SchedulerAdapter {
  /**
   * Schedule a job with distributed locking support
   */
  schedule(job: ScheduledJob): Promise<string>

  /**
   * Unschedule a job
   */
  unschedule(jobId: string): Promise<boolean>

  /**
   * Start the scheduler (begins processing scheduled jobs)
   */
  start(): Promise<void>

  /**
   * Stop the scheduler and release all locks
   */
  stop(): Promise<void>

  /**
   * Get all scheduled jobs (in-memory, for this instance)
   */
  getScheduledJobs(): Promise<ScheduledJob[]>

  /**
   * Get jobs matching a pattern (e.g., by runId)
   * Queries persisted store, works across all instances
   * More efficient than getAllPersistedJobs() when filtering
   */
  getJobsByPattern(pattern: string): Promise<ScheduledJob[]>

  /**
   * Get all persisted jobs from store (across all instances)
   * Useful for debugging and monitoring in horizontal setups
   */
  getAllPersistedJobs(): Promise<ScheduledJob[]>

  /**
   * Check if scheduler is healthy
   */
  isHealthy(): Promise<boolean>
}

export interface SchedulerLock {
  jobId: string
  instanceId: string
  acquiredAt: number
  expiresAt: number
}

export interface SchedulerStats {
  jobId: string
  lastRun: number
  nextRun?: number
  runCount: number
  failCount: number
  lastError?: string
}
