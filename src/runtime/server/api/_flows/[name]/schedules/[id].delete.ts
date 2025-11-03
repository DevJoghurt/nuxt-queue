import { defineEventHandler, getRouterParam, createError, useRuntimeConfig, $useQueueRegistry } from '#imports'
import { Queue } from 'bullmq'

export default defineEventHandler(async (event) => {
  const flowName = getRouterParam(event, 'name')
  const scheduleId = getRouterParam(event, 'id')

  if (!flowName || !scheduleId) {
    throw createError({ statusCode: 400, statusMessage: 'Flow name and schedule ID are required' })
  }

  // Get flow info from registry
  const registry = $useQueueRegistry() as any
  const flow = registry?.flows?.[flowName]
  if (!flow || !flow.entry) {
    throw createError({ statusCode: 404, statusMessage: `Flow '${flowName}' not found` })
  }

  const rc = useRuntimeConfig() as any
  const connection = rc.queue?.redis

  const queue = new Queue(flow.entry.queue, { connection })

  try {
    // Remove repeatable job by key
    await queue.removeRepeatableByKey(scheduleId)
    await queue.close()

    return {
      success: true,
      message: 'Schedule deleted successfully',
    }
  }
  catch (error: any) {
    await queue.close()
    throw createError({
      statusCode: 500,
      statusMessage: `Failed to delete schedule: ${error.message}`,
    })
  }
})
