import { defineEventHandler, getQuery, createEventStream, $useEventBus, $useStreamNames } from '#imports'

export default defineEventHandler(async (event) => {
  const eventStream = createEventStream(event)
  const q = getQuery(event)
  const streams = $useStreamNames()
  const stream = typeof q.stream === 'string' ? q.stream : streams.global
  const { subscribeStream } = $useEventBus()

  // Initial message
  await eventStream.push(JSON.stringify({ ok: true, subscribed: stream }))

  // Bus subscription to forward events into SSE
  const unsub = subscribeStream(stream, (e) => {
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
