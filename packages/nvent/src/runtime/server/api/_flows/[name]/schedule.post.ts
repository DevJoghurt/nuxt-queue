import { defineEventHandler, readBody, getRouterParam, createError, useQueueAdapter, $useQueueRegistry } from '#imports'

export default defineEventHandler(async (event) => {
  const flowName = getRouterParam(event, 'name')
  if (!flowName) {
    throw createError({ statusCode: 400, statusMessage: 'Flow name is required' })
  }

  const body = await readBody(event)
  const { input, cron, delay, jobId, metadata } = body

  // Validate: either cron OR delay, not both
  if (cron && delay) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Cannot specify both cron and delay',
    })
  }

  if (!cron && !delay) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Must specify either cron or delay',
    })
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

  // Check if adapters are initialized
  let queue: any
  try {
    queue = useQueueAdapter()
  }
  catch (err) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Server initializing',
      data: 'Queue adapter not ready yet, please retry',
    })
  }

  // Create schedule options
  const scheduleOpts: any = {}
  if (cron) scheduleOpts.cron = cron
  if (delay) scheduleOpts.delay = delay

  // Mark this job as a scheduled flow starter
  // The worker will detect this and call startFlow() instead of the normal handler
  const jobData = {
    __scheduledFlowStart: true,
    __flowName: flowName,
    __flowInput: input || {},
    __schedule: {
      metadata,
      createdAt: new Date().toISOString(),
    },
  }

  // Schedule the job in the flow's entry queue
  const id = await queue.schedule(
    queueName,
    {
      name: flow.entry.step,
      data: jobData,
      opts: jobId ? { jobId } : undefined,
    },
    scheduleOpts,
  )

  return {
    id,
    flowName,
    queue: queueName,
    step: flow.entry.step,
    schedule: scheduleOpts,
    createdAt: new Date().toISOString(),
  }
})
