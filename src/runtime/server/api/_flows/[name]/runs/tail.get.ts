import { defineEventHandler, getRouterParam, createEventStream, setHeader, useRuntimeConfig, useFlows } from '#imports'

export default defineEventHandler(async (event) => {
  const rc: any = useRuntimeConfig()
  const flowName = getRouterParam(event, 'name')
  const DEBUG = rc?.queue?.debug?.events || process.env.NQ_DEBUG_EVENTS === '1'
  if (!flowName) return 'missing params'
  if (DEBUG) console.log('[nq][sse][runs] subscribing to flow runs', { flowName })
  const eventStream = createEventStream(event)
  const flow = useFlows()
  // Defensive headers for SSE
  setHeader(event, 'X-Accel-Buffering', 'no')
  setHeader(event, 'Cache-Control', 'no-cache')
  setHeader(event, 'Connection', 'keep-alive')
  setHeader(event, 'Content-Type', 'text/event-stream; charset=utf-8')

  const unsub = flow.onFlowRuns(String(flowName), (e: any) => {
    if (DEBUG) console.log('[nq][sse][runs] recv', { stream: e?.stream, id: e?.id, kind: e?.kind })
    void eventStream.push(JSON.stringify({ v: 1, stream: e?.stream, event: e.kind, record: e }))
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
