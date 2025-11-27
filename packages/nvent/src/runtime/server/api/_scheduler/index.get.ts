import { defineEventHandler } from 'h3'
import { useScheduler } from '#imports'

/**
 * Get all scheduled jobs with their status
 * Returns jobs persisted across all instances
 */
export default defineEventHandler(async () => {
  try {
    const scheduler = useScheduler()
    
    // Get both in-memory (current instance) and persisted (all instances) jobs
    const [scheduledJobs, persistedJobs] = await Promise.all([
      scheduler.getScheduledJobs(),
      scheduler.getAllPersistedJobs(),
    ])

    return {
      instance: {
        jobs: scheduledJobs,
        count: scheduledJobs.length,
      },
      global: {
        jobs: persistedJobs,
        count: persistedJobs.length,
      },
      healthy: await scheduler.isHealthy(),
    }
  }
  catch (error) {
    console.error('Failed to get scheduler info:', error)
    return {
      instance: { jobs: [], count: 0 },
      global: { jobs: [], count: 0 },
      healthy: false,
      error: (error as Error).message,
    }
  }
})
