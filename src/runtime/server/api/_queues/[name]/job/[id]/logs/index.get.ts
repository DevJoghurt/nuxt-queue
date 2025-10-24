import { defineEventHandler, getRouterParam, getQuery, useLogs } from '#imports'

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name')
  const id = getRouterParam(event, 'id')
  if (!name || !id) return []
  const q = getQuery(event)
  const fromId = typeof q.fromId === 'string' ? q.fromId : undefined
  const limit = q.limit ? Number(q.limit) : 200
  const logs = useLogs()
  const res = await logs.getJobLogs(String(id), { limit, fromId, direction: 'backward', paged: true }) as { items: any[], nextFromId?: string }
  return res
})
