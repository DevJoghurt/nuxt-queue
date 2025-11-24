import { defineEventHandler, getRouterParam, getQuery, useQueueAdapter, createError } from '#imports'

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name')
  if (!name) {
    throw createError({ statusCode: 400, statusMessage: 'Missing queue name' })
  }

  const query = getQuery(event)
  const state = query.state as string | undefined
  const limit = query.limit ? Number.parseInt(query.limit as string, 10) : 50
  const offset = query.offset ? Number.parseInt(query.offset as string, 10) : 0

  // Check if adapters are initialized
  let queue: any
  try {
    queue = useQueueAdapter()
  }
  catch {
    throw createError({
      statusCode: 503,
      statusMessage: 'Server initializing',
      data: 'Queue adapter not ready yet, please retry',
    })
  }

  // Get total count first
  const allJobs = await queue.getJobs(name, {
    state: state ? [state as any] : undefined,
    limit: 10000, // Large number to get all for counting
  })

  const totalCount = allJobs?.length || 0

  // Sort by timestamp descending (newest first)
  const sortedJobs = (allJobs || []).sort((a: any, b: any) => {
    const aTime = a.timestamp || 0
    const bTime = b.timestamp || 0
    return bTime - aTime
  })

  // Apply pagination
  const paginatedJobs = sortedJobs.slice(offset, offset + limit)

  return {
    jobs: paginatedJobs,
    count: paginatedJobs.length,
    total: totalCount,
    hasMore: offset + limit < totalCount,
  }
})
