import { defineEventHandler, getRouterParam, createEventStream, $useEventBus, $useStreamNames } from '#imports'

export default defineEventHandler(async (event) => {
  const flowId = getRouterParam(event, 'id')
  const runId = getRouterParam(event, 'runId')
  if (!flowId || !runId) return 'missing params'
  const streams = $useStreamNames()
  const flowStream = typeof streams.flow === 'function' ? streams.flow(runId) : `${streams.flow}${runId}`
  const eventStream = createEventStream(event)
  const { subscribeStream } = $useEventBus()

  await eventStream.push(JSON.stringify({ ok: true, flowId, runId, subscribed: flowStream }))
  const unsub = subscribeStream(flowStream, (e) => {
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
