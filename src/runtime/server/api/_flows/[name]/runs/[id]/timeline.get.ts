import { defineEventHandler, getRouterParam, getQuery, useFlows } from '#imports'

export default defineEventHandler(async (event) => {
  const runId = getRouterParam(event, 'id')
  if (!runId) return []
  const q = getQuery(event)
  const fromId = typeof q.fromId === 'string' ? q.fromId : undefined
  const limit = q.limit ? Number(q.limit) : 200
  const flow = useFlows()
  const res = await flow.getFlowTimeline(runId, { limit, fromId, direction: 'backward', paged: true }) as { items: any[], nextFromId?: string }
  return res
})
