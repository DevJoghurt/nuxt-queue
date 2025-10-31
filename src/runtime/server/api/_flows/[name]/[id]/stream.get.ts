import { defineEventHandler, getRouterParam, createEventStream, setHeader, useStreamStore } from '#imports'

/**
 * GET /api/_flows/:name/:id/stream
 *
 * SSE stream for a specific flow run
 */
export default defineEventHandler(async (event) => {
  const flowName = getRouterParam(event, 'name')
  const runId = getRouterParam(event, 'id')

  if (!flowName || !runId) {
    return { error: 'Missing flow name or run ID' }
  }

  const eventStream = createEventStream(event)
  const store = useStreamStore()
  const names = store.names()

  // Defensive headers for SSE
  setHeader(event, 'X-Accel-Buffering', 'no')
  setHeader(event, 'Cache-Control', 'no-cache')
  setHeader(event, 'Connection', 'keep-alive')
  setHeader(event, 'Content-Type', 'text/event-stream; charset=utf-8')

  try {
    // Use centralized naming function
    const flowStream = names.flow(runId)

    console.log('[flows/stream] Starting stream:', { flowName, runId, flowStream })

    // Subscribe to live events
    const unsub = store.subscribe(flowStream, async (e: any) => {
      await eventStream.push(JSON.stringify({ v: 1, event: e.type, record: e }))
    })

    // Cleanup on connection close
    eventStream.onClosed(async () => {
      console.log('[flows/stream] Connection closed:', { flowName, runId })
      try {
        unsub()
      }
      catch (err) {
        console.error('[flows/stream] error unsubscribing:', err)
      }
      await eventStream.close()
    })

    // Establish SSE connection
    const stream = eventStream.send()

    // Backfill historical events after connection is established
    setImmediate(async () => {
      try {
        const historicalEvents = await store.read(flowStream, {
          limit: 100,
          direction: 'forward',
        })

        console.log('[flows/stream] Backfilling events:', historicalEvents.length)

        for (const e of historicalEvents) {
          await eventStream.push(JSON.stringify({ v: 1, event: e.kind, record: e }))
        }
      }
      catch (err) {
        console.error('[flows/stream] backfill error:', err)
      }
    })

    return stream
  }
  catch (err) {
    console.error('[flows/stream] error:', err)
    await eventStream.close()
    throw err
  }
})
