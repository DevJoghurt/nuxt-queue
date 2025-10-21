import { defineEventHandler, getRouterParam, getQuery, $useEventStoreProvider, $useStreamNames } from '#imports'

export default defineEventHandler(async (event) => {
  const flowId = getRouterParam(event, 'id')
  const runId = getRouterParam(event, 'runId')
  if (!flowId || !runId) return []
  const streams = $useStreamNames()
  const flowStream = typeof streams.flow === 'function' ? streams.flow(runId) : `${streams.flow}${runId}`
  const store = $useEventStoreProvider()
  const q = getQuery(event)
  const fromId = typeof q.fromId === 'string' ? q.fromId : undefined
  const limit = q.limit ? Number(q.limit) : 200
  const recs = await store.read(flowStream, { limit, fromId })
  return recs
})
