import { $useEventStoreProvider, $useStreamNames, defineEventHandler, getRouterParam, getQuery } from '#imports'

export default defineEventHandler(async (event) => {
  const flowId = getRouterParam(event, 'id')
  const runId = getRouterParam(event, 'runId')
  if (!flowId || !runId) return []
  const q = getQuery(event)
  const fromId = typeof q.fromId === 'string' ? q.fromId : undefined
  const limit = q.limit ? Number(q.limit) : undefined

  const streams = $useStreamNames() as any
  const streamName = typeof streams.flow === 'function' ? streams.flow(String(runId)) : String(streams.flow) + String(runId)
  const store = $useEventStoreProvider()
  const recs = await store.read(streamName, { fromId, limit })
  return (recs || []).filter(r => r?.kind === 'runner.log')
})
