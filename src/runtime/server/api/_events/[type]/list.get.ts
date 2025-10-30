import { defineEventHandler, getRouterParam, useEventStreams, getQuery, useRuntimeConfig } from '#imports'

/**
 * v0.3 Generic List Endpoint
 *
 * GET /api/_events/:type/list?name=<name>&limit=50
 *
 * Lists items from the sorted set index.
 *
 * Examples:
 * - GET /api/_events/flow/list?name=example-flow&limit=20
 * - GET /api/_events/trigger/list?limit=10
 */
export default defineEventHandler(async (event) => {
  const rc: any = useRuntimeConfig()
  const type = getRouterParam(event, 'type')
  const query = getQuery(event)
  const name = query.name as string | undefined
  const limit = Math.min(Number.parseInt(query.limit as string) || 50, 100)

  const DEBUG = rc?.queue?.debug?.events || process.env.NQ_DEBUG_EVENTS === '1'

  if (!type) {
    return { error: 'Missing type parameter' }
  }

  if (DEBUG) {
    console.log('[nq][api][list] listing items', { type, name, limit })
  }

  const streams = useEventStreams()

  try {
    const items = await streams.listItems(type, name, { limit })

    if (DEBUG) {
      console.log('[nq][api][list] found items', { type, name, count: items.length })
    }

    return {
      type,
      name,
      count: items.length,
      items,
    }
  }
  catch (err) {
    console.error('[nq][api][list] error:', err)
    return {
      error: 'Failed to list items',
      message: err instanceof Error ? err.message : String(err),
    }
  }
})
