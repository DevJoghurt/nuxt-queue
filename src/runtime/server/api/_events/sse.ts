import { defineEventHandler, getQuery, createEventStream, useEventManager, setHeader, useRuntimeConfig } from '#imports'

export default defineEventHandler(async (event) => {
  const rc: any = useRuntimeConfig()
  const { subscribeStream, getStreamNames } = useEventManager()
  const DEBUG = rc?.queue?.debug?.events || process.env.NQ_DEBUG_EVENTS === '1'
  const eventStream = createEventStream(event)
  const q = getQuery(event)
  const streams = getStreamNames()
  const stream = typeof q.stream === 'string' ? q.stream : streams.global
  // Defensive headers for buffering proxies
  setHeader(event, 'X-Accel-Buffering', 'no')
  setHeader(event, 'Cache-Control', 'no-cache')
  setHeader(event, 'Connection', 'keep-alive')
  setHeader(event, 'Content-Type', 'text/event-stream; charset=utf-8')

  // Bus subscription to forward events into SSE
  const unsub = subscribeStream(stream, (e) => {
    if (DEBUG) console.log('[nq][sse][events] recv', { stream, id: e?.id, kind: e?.kind })
    void eventStream.push(JSON.stringify({ v: 1, stream, event: e.kind, record: e }))
  })

  eventStream.onClosed(async () => {
    try {
      unsub()
    }
    catch {
      // ignore
    }
    await eventStream.close()
  })

  return eventStream.send()
})
