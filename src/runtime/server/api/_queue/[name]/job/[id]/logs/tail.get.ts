import { defineEventHandler, getRouterParam, createEventStream, $useEventBus, $useStreamNames } from '#imports'

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name')
  const id = getRouterParam(event, 'id')
  if (!name || !id) return 'missing params'
  const streams = $useStreamNames() as any
  const jobStream = typeof streams.job === 'function' ? streams.job(String(id)) : String(streams.job) + String(id)
  const eventStream = createEventStream(event)
  const { subscribeStream } = $useEventBus()

  await eventStream.push(JSON.stringify({ ok: true, name, id, subscribed: jobStream }))
  const unsub = subscribeStream(jobStream, (e) => {
    if (e?.kind !== 'runner.log') return
    void eventStream.push(JSON.stringify({ v: 1, stream: jobStream, event: e.kind, record: e }))
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
