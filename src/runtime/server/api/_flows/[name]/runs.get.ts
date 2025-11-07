import { defineEventHandler, getRouterParam, getQuery, useEventStore, useServerLogger } from '#imports'

const logger = useServerLogger('api-flows-runs')

/**
 * GET /api/_flows/:name/runs?limit=50&offset=0
 *
 * List runs for a specific flow with pagination support
 */
export default defineEventHandler(async (event) => {
  const flowName = getRouterParam(event, 'name')
  const query = getQuery(event)
  const limit = Math.min(Number.parseInt(query.limit as string) || 50, 100)
  const offset = Math.max(Number.parseInt(query.offset as string) || 0, 0)
  const status = query.status as 'running' | 'completed' | 'failed' | undefined

  // Prevent caching - always fetch fresh data
  event.node.res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
  event.node.res.setHeader('Pragma', 'no-cache')

  if (!flowName) {
    return { error: 'Missing flow name' }
  }

  const store = useEventStore()
  const names = store.names()

  try {
    // Use centralized naming function
    const runIndexKey = names.flowIndex(flowName)

    // First, get the total count (Redis ZCARD for sorted sets)
    // We'll need to add a method to get the count
    let totalCount = 0
    try {
      // For now, we'll fetch a large limit to get the count
      // This can be optimized by adding a `indexCount` method to the adapter
      const allEntries = await store.indexRead(runIndexKey, { limit: 10000 })
      totalCount = allEntries.length
    }
    catch {
      totalCount = 0
    }

    // Read paginated results from the sorted set index
    const entries = await store.indexRead(runIndexKey, { offset, limit })

    // Filter by status if provided (using metadata)
    const filteredEntries = status
      ? entries.filter(e => e.metadata?.status === status)
      : entries

    // Build response items with status information
    const items = filteredEntries.map(entry => ({
      id: entry.id,
      flowName,
      status: entry.metadata?.status || 'unknown',
      createdAt: new Date(entry.score).toISOString(),
      startedAt: entry.metadata?.startedAt
        ? new Date(entry.metadata.startedAt).toISOString()
        : undefined,
      completedAt: entry.metadata?.completedAt
        ? new Date(entry.metadata.completedAt).toISOString()
        : undefined,
      stepCount: entry.metadata?.stepCount || 0,
      completedSteps: entry.metadata?.completedSteps || 0,
    }))

    return {
      flowName,
      count: items.length,
      total: totalCount,
      offset,
      limit,
      hasMore: offset + items.length < totalCount,
      items,
    }
  }
  catch (err) {
    logger.error('[flows/runs] error:', { error: err })
    return {
      error: 'Failed to list runs',
      message: err instanceof Error ? err.message : String(err),
    }
  }
})
