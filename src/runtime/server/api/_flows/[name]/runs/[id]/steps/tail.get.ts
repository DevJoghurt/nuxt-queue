import { defineEventHandler, getRouterParam, createEventStream, setHeader, useRuntimeConfig, useStreamStore } from '#imports'

export default defineEventHandler(async (event) => {
  const rc: any = useRuntimeConfig()
  const DEBUG = rc?.queue?.debug?.events || process.env.NQ_DEBUG_EVENTS === '1'
  const runId = getRouterParam(event, 'id')
  if (!runId) return 'missing run id'

  // Projection stream: per-run steps patches
  const stepsStream = `nq:proj:flow-steps:${String(runId)}`
  const store = useStreamStore()

  if (DEBUG) console.log('[nq][sse][flow-steps] subscribing', { runId, stream: stepsStream })

  const eventStream = createEventStream(event)
  // Defensive headers for SSE / proxies
  setHeader(event, 'X-Accel-Buffering', 'no')
  setHeader(event, 'Cache-Control', 'no-cache')
  setHeader(event, 'Connection', 'keep-alive')
  setHeader(event, 'Content-Type', 'text/event-stream; charset=utf-8')

  const unsub = store.subscribe(stepsStream, (e) => {
    if (DEBUG) console.log('[nq][sse][flow-steps] recv', { id: e?.id, kind: e?.kind })
    void eventStream.push(JSON.stringify({ v: 1, stream: stepsStream, event: e.kind, record: e }))
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
