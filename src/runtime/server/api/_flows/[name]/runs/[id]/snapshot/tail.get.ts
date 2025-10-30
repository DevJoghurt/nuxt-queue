import { defineEventHandler, getRouterParam, createEventStream, setHeader, useRuntimeConfig, useStreamStore } from '#imports'

export default defineEventHandler(async (event) => {
  const rc: any = useRuntimeConfig()
  const DEBUG = rc?.queue?.debug?.events || process.env.NQ_DEBUG_EVENTS === '1'
  const flowName = getRouterParam(event, 'name')
  const runId = getRouterParam(event, 'id')
  if (!flowName || !runId) return 'missing params'

  // Projection stream: flow snapshot patches for this run
  const snapStream = `nq:proj:flow:${String(flowName)}:${String(runId)}`
  const store = useStreamStore()

  if (DEBUG) console.log('[nq][sse][flow-snapshot] subscribing', { flowName, runId, stream: snapStream })

  const eventStream = createEventStream(event)
  setHeader(event, 'X-Accel-Buffering', 'no')
  setHeader(event, 'Cache-Control', 'no-cache')
  setHeader(event, 'Connection', 'keep-alive')
  setHeader(event, 'Content-Type', 'text/event-stream; charset=utf-8')

  const unsub = store.subscribe(snapStream, (e) => {
    if (DEBUG) console.log('[nq][sse][flow-snapshot] recv', { id: e?.id, kind: e?.kind, stream: e?.stream })
    try {
      const payload = JSON.stringify({ v: 1, stream: snapStream, event: e.kind, record: e })
      eventStream.push(payload)
      if (DEBUG) console.log('[nq][sse][flow-snapshot] pushed', { id: e?.id })
    }
    catch (err) {
      if (DEBUG) console.error('[nq][sse][flow-snapshot] push error', err)
    }
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
