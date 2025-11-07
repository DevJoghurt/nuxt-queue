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

  // Extract queue name (handle both string and object formats)
  const queueName = typeof flow.entry.queue === 'string'
    ? flow.entry.queue
    : flow.entry.queue?.name || flow.entry.queue

  const rc = useRuntimeConfig() as any
  const connection = rc.queue?.redis

  // Get queue prefix from registry worker config
  let prefix: string | undefined
  try {
    if (registry && Array.isArray(registry.workers)) {
      const worker = registry.workers.find((w: any) => w?.queue?.name === queueName)
      if (worker?.queue?.prefix) {
        prefix = worker.queue.prefix
      }
    }
  }
  catch {
    // ignore
  }

  const queue = new Queue(queueName, { connection, prefix })

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
