import { defineEventHandler, getRouterParam, getQuery, useStreamStore } from '#imports'

/**
 * GET /api/_flows/:name/runs?limit=50
 *
 * List recent runs for a specific flow
 */
export default defineEventHandler(async (event) => {
  const flowName = getRouterParam(event, 'name')
  const query = getQuery(event)
  const limit = Math.min(Number.parseInt(query.limit as string) || 50, 100)

  if (!flowName) {
    return { error: 'Missing flow name' }
  }

  const store = useStreamStore()
  const names = store.names()

  try {
    // Use centralized naming function
    const runIndexKey = names.flowIndex(flowName)

    // Read from the sorted set index using the abstracted method
    const entries = await store.indexRead(runIndexKey, { limit })

    // Build response items
    const items = entries.map(entry => ({
      id: entry.id,
      flowName,
      createdAt: new Date(entry.score).toISOString(),
    }))

    return {
      flowName,
      count: items.length,
      items,
    }
  }
  catch (err) {
    console.error('[flows/runs] error:', err)
    return {
      error: 'Failed to list runs',
      message: err instanceof Error ? err.message : String(err),
    }
  }
})
