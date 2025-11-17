import { defineEventHandler, getRouterParam, getQuery, useQueueAdapter, createError } from '#imports'

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name')
  if (!name) {
    throw createError({ statusCode: 400, statusMessage: 'Missing queue name' })
  }

  const query = getQuery(event)
  const state = query.state as string | undefined

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

  // Get all jobs (with state filter if provided)
  const jobs = await queue.getJobs(name, {
    state: state ? [state as any] : undefined,
    limit: 1000, // Fetch all jobs, pagination happens client-side
  })

  return {
    jobs,
  }
})
