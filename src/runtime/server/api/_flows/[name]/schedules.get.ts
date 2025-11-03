import { defineEventHandler, getRouterParam, createError, useRuntimeConfig, $useQueueRegistry } from '#imports'
import { Queue } from 'bullmq'

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

  const rc = useRuntimeConfig() as any
  const connection = rc.queue?.redis

  // Get repeatable jobs from BullMQ
  const queue = new Queue(flow.entry.queue, { connection })
  try {
    const repeatableJobs = await queue.getRepeatableJobs()

    // Filter for this flow's entry step
    const schedules = repeatableJobs
      .filter(job => job.name === flow.entry.step)
      .map(job => ({
        id: job.key,
        flowName,
        queue: flow.entry.queue,
        step: flow.entry.step,
        schedule: {
          cron: job.pattern,
        },
        nextRun: job.next ? new Date(job.next).toISOString() : undefined,
      }))

    await queue.close()
    return schedules
  }
  catch (error: any) {
    await queue.close()
    throw createError({
      statusCode: 500,
      statusMessage: `Failed to list schedules: ${error.message}`,
    })
  }
})
