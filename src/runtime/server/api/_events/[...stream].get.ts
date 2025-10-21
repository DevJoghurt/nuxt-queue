import { $useEventStoreProvider, defineEventHandler, getRouterParam, getQuery } from '#imports'

export default defineEventHandler(async (events) => {
  const stream = getRouterParam(events, 'stream')
  if (!stream) return []
  const s = Array.isArray(stream) ? stream.join('/') : stream
  const q = getQuery(events)
  const fromId = typeof q.fromId === 'string' ? q.fromId : undefined
  const limit = q.limit ? Number(q.limit) : undefined
  const store = $useEventStoreProvider()
  const recs = await store.read(s, { fromId, limit })
  return recs
})
