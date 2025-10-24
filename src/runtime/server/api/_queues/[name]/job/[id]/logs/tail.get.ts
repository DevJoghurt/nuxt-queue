import { defineEventHandler, getRouterParam, createEventStream, setHeader, useLogs } from '#imports'

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name')
  const id = getRouterParam(event, 'id')
  if (!name || !id) return 'missing params'
  const eventStream = createEventStream(event)
  const logs = useLogs()

  // Defensive headers for SSE
  setHeader(event, 'X-Accel-Buffering', 'no')
  setHeader(event, 'Cache-Control', 'no-cache')
  setHeader(event, 'Connection', 'keep-alive')
  setHeader(event, 'Content-Type', 'text/event-stream; charset=utf-8')

  const unsub = logs.onJobLog(String(id), (e) => {
    void eventStream.push(JSON.stringify({ v: 1, stream: e.raw?.stream, event: 'runner.log', record: e.raw }))
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
