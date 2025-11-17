import { defineEventHandler, getRouterParam, createError, useQueueAdapter, $useQueueRegistry } from '#imports'

export default defineEventHandler(async (event) => {
  const flowName = getRouterParam(event, 'name')
  if (!flowName) {
    throw createError({ statusCode: 400, statusMessage: 'Flow name is required' })
  }

  // Get flow info from registry
  const registry = $useQueueRegistry() as any
  const flow = registry?.flows?.[flowName]
  if (!flow || !flow.entry) {
    throw createError({ statusCode: 404, statusMessage: `Flow '${flowName}' not found` })
  }

  // Extract queue name (handle both string and object formats)
  const queueName = typeof flow.entry.queue === 'string'
    ? flow.entry.queue
    : flow.entry.queue?.name || flow.entry.queue

  const adapter = useQueueAdapter()

  // Check if adapter supports scheduled jobs
  if (!adapter.getScheduledJobs) {
    throw createError({
      statusCode: 501,
      statusMessage: 'Queue adapter does not support scheduled jobs',
    })
  }

  try {
    const scheduledJobs = await adapter.getScheduledJobs(queueName)

    // Filter for this flow's entry step
    const schedules = scheduledJobs
      .filter(job => job.jobName === flow.entry.step)
      .map(job => ({
        id: job.id,
        flowName,
        queue: queueName,
        step: flow.entry.step,
        schedule: {
          cron: job.cron || job.pattern,
        },
        nextRun: job.nextRun ? job.nextRun.toISOString() : undefined,
        repeatCount: job.repeatCount,
        limit: job.limit,
      }))

    return schedules
  }
  catch (error: any) {
    throw createError({
      statusCode: 500,
      statusMessage: `Failed to list schedules: ${error.message}`,
    })
  }
})
