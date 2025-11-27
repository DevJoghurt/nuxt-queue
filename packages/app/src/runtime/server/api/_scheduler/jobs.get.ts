import { defineEventHandler } from 'h3'
import { useScheduler } from '#imports'

/**
 * Get all scheduled jobs
 * Returns list of jobs with their metadata and execution info
 */
export default defineEventHandler(async () => {
  try {
    const scheduler = useScheduler()

    // Get all persisted jobs from the scheduler
    const allJobs = await scheduler.getAllPersistedJobs()

    // Calculate stats
    const stats = {
      total: allJobs.length,
      active: allJobs.filter((job) => {
        if (job.type === 'one-time') {
          return job.executeAt && job.executeAt > Date.now()
        }
        return job.enabled !== false // interval and cron jobs are active if enabled
      }).length,
      lastRun: allJobs.reduce((latest, job) => {
        if (job.lastRun && (!latest || job.lastRun > latest)) {
          return job.lastRun
        }
        return latest
      }, 0 as number),
    }

    return {
      jobs: allJobs,
      stats,
    }
  }
  catch (error) {
    console.error('Failed to get scheduler jobs:', error)
    return {
      jobs: [],
      stats: {
        total: 0,
        active: 0,
      },
    }
  }
})
