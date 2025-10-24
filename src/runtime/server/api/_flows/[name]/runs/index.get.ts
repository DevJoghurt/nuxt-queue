import { defineEventHandler, getRouterParam, getQuery, useFlows as useFlow } from '#imports'

export default defineEventHandler(async (event) => {
  const flowName = getRouterParam(event, 'name')
  if (!flowName) return []
  const q = getQuery(event)
  const limit = q.limit ? Number(q.limit) : 50
  // scanLimit not needed with cursor-based paging using backward reads
  const flow = useFlow()
  const fromId = typeof q.fromId === 'string' ? q.fromId : undefined
  const res = await flow.getFlowRuns(flowName, { limit, fromId, paged: true }) as { items: any[], nextFromId?: string }
  return res
})
