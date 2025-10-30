import { defineEventHandler, useEventStreams, getRouterParam, createEventStream, setHeader, useRuntimeConfig } from '#imports'

/**
 * v0.3 Generic SSE Endpoint
 *
 * GET /api/_events/:type/:id/stream
 *
 * Examples:
 * - GET /api/_events/flow/abc-123-def/stream
 * - GET /api/_events/trigger/approval-123/stream
 *
 * Pattern:
 * 1. Backfill historical events via XRANGE
 * 2. Subscribe to live events via Pub/Sub
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
    console.log('[nq][sse][generic] starting stream', { type, id })
  }

  const eventStream = createEventStream(event)
  const streams = useEventStreams()

  // Defensive headers for SSE
  setHeader(event, 'X-Accel-Buffering', 'no')
  setHeader(event, 'Cache-Control', 'no-cache')
  setHeader(event, 'Connection', 'keep-alive')
  setHeader(event, 'Content-Type', 'text/event-stream; charset=utf-8')

  try {
    // 2. Subscribe to live events FIRST (before backfill to avoid missing events)
    const subscription = await streams.subscribeToStream(type, id, async (e: any) => {
      if (DEBUG) {
        console.log('[nq][sse][generic] live event', { type, id, kind: e.kind })
      }
      await eventStream.push(JSON.stringify({ v: 1, event: e.kind, record: e }))
    })

    // Cleanup on connection close
    eventStream.onClosed(async () => {
      if (DEBUG) {
        console.log('[nq][sse][generic] connection closed', { type, id })
      }
      try {
        subscription.unsubscribe()
      }
      catch (err) {
        console.error('[nq][sse][generic] error unsubscribing:', err)
      }
      await eventStream.close()
    })

    // IMPORTANT: Call send() to establish the SSE connection
    const stream = eventStream.send()

    // 1. Backfill historical events AFTER send() is called
    // This ensures the connection is established before pushing
    setImmediate(async () => {
      try {
        const historicalEvents = await streams.readEvents(type, id, {
          limit: 100,
          direction: 'forward',
        })

        if (DEBUG) {
          console.log('[nq][sse][generic] backfill', { type, id, count: historicalEvents.length })
        }

        for (const e of historicalEvents) {
          await eventStream.push(JSON.stringify({ v: 1, event: e.type, record: e }))
        }
      }
      catch (err) {
        console.error('[nq][sse][generic] backfill error:', err)
      }
    })

    return stream
  }
  catch (err) {
    console.error('[nq][sse][generic] error:', err)
    await eventStream.close()
    throw err
  }
})
