import { defineEventHandler, getRouterParam, createEventStream, setHeader, useRuntimeConfig, useEventManager } from '#imports'

export default defineEventHandler(async (event) => {
  const rc: any = useRuntimeConfig()
  const DEBUG = rc?.queue?.debug?.events || process.env.NQ_DEBUG_EVENTS === '1'
  const runId = getRouterParam(event, 'id')
  if (!runId) return 'missing run id'

  const { subscribeStream, getStreamNames } = useEventManager()
  const names = getStreamNames()
  const flowStream = typeof (names as any).flow === 'function' ? (names as any).flow(String(runId)) : String((names as any).flow) + String(runId)

  if (DEBUG) console.log('[nq][sse][flow-run] subscribing', { runId, stream: flowStream })

  const eventStream = createEventStream(event)
  // Defensive headers for SSE / proxies
  setHeader(event, 'X-Accel-Buffering', 'no')
  setHeader(event, 'Cache-Control', 'no-cache')
  setHeader(event, 'Connection', 'keep-alive')
  setHeader(event, 'Content-Type', 'text/event-stream; charset=utf-8')

  const unsub = subscribeStream(flowStream, (e) => {
    if (DEBUG) console.log('[nq][sse][flow-run] recv', { id: e?.id, kind: e?.kind })
    void eventStream.push(JSON.stringify({ v: 1, stream: flowStream, event: e.kind, record: e }))
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
