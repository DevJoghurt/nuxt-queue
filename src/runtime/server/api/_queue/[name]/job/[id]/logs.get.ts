import { $useEventStoreProvider, $useStreamNames, defineEventHandler, getRouterParam, getQuery } from '#imports'

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name')
  const id = getRouterParam(event, 'id')
  if (!name || !id) return []
  const q = getQuery(event)
  const fromId = typeof q.fromId === 'string' ? q.fromId : undefined
  const limit = q.limit ? Number(q.limit) : undefined

  const streams = $useStreamNames() as any
  const streamName = typeof streams.job === 'function' ? streams.job(String(id)) : String(streams.job) + String(id)
  const store = $useEventStoreProvider()
  const recs = await store.read(streamName, { fromId, limit })
  // logs only
  return (recs || []).filter(r => r?.kind === 'runner.log')
})
