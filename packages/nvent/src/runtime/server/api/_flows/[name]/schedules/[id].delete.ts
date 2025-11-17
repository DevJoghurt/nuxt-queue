import { defineEventHandler, getRouterParam, createError, useQueueAdapter, $useQueueRegistry } from '#imports'

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

  const adapter = useQueueAdapter()

  // Check if adapter supports scheduled jobs removal
  if (!adapter.removeScheduledJob) {
    throw createError({
      statusCode: 501,
      statusMessage: 'Queue adapter does not support scheduled jobs removal',
    })
  }

  try {
    const removed = await adapter.removeScheduledJob(scheduleId)

    if (!removed) {
      throw createError({ statusCode: 404, statusMessage: 'Schedule not found' })
    }

    return {
      success: true,
      message: 'Schedule deleted successfully',
    }
  }
  catch (error: any) {
    if (error.statusCode === 404) {
      throw error
    }
    throw createError({
      statusCode: 500,
      statusMessage: `Failed to delete schedule: ${error.message}`,
    })
  }
})
