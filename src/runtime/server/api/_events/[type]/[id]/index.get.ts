import { defineEventHandler, useEventStreams, getRouterParam, useRuntimeConfig } from '#imports'

/**
 * v0.3 Generic State Snapshot Endpoint
 *
 * GET /api/_events/:type/:id
 *
 * Returns the current state by reading all events and reducing them.
 *
 * Examples:
 * - GET /api/_events/flow/abc-123-def
 * - GET /api/_events/trigger/approval-123
 */
export default defineEventHandler(async (event) => {
  const rc: any = useRuntimeConfig()
  const type = getRouterParam(event, 'type')
  const id = getRouterParam(event, 'id')

  const DEBUG = rc?.queue?.debug?.events || process.env.NQ_DEBUG_EVENTS === '1'

  if (!type || !id) {
    return { error: 'Missing type or id parameter' }
  }

  if (DEBUG) {
    console.log('[nq][api][state] fetching state', { type, id })
  }

  const streams = useEventStreams()

  try {
    // Read all events from the stream
    const events = await streams.readEvents(type, id, {
      limit: 1000, // Adjust based on expected event count
      direction: 'forward',
    })

    if (DEBUG) {
      console.log('[nq][api][state] read events', { type, id, count: events.length })
    }

    // Return raw events for now
    // Client-side reducers will compute state
    return {
      type,
      id,
      eventCount: events.length,
      events,
    }
  }
  catch (err) {
    console.error('[nq][api][state] error:', err)
    return {
      error: 'Failed to fetch state',
      message: err instanceof Error ? err.message : String(err),
    }
  }
})
