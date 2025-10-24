import { defineEventHandler, getRouterParam, getQuery, useLogs } from '#imports'

export default defineEventHandler(async (event) => {
  const flowName = getRouterParam(event, 'name')
  const runId = getRouterParam(event, 'id')
  if (!flowName || !runId) return []
  const q = getQuery(event)
  const fromId = typeof q.fromId === 'string' ? q.fromId : undefined
  const limit = q.limit ? Number(q.limit) : 200
  const logs = useLogs()
  const res = await logs.getFlowRunLogs(String(runId), { limit, fromId, direction: 'backward', paged: true }) as { items: any[], nextFromId?: string }
  return res
})
