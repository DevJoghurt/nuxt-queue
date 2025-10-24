import { defineEventHandler, getRouterParam, getQuery, useEventManager } from '#imports'

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name')
  if (!name) return []
  const q = getQuery(event)
  const fromId = typeof q.fromId === 'string' ? q.fromId : undefined
  const limit = q.limit ? Number(q.limit) : undefined
  const direction = q.direction === 'backward' ? 'backward' : 'forward'
  const paged = q.paged === '1' || q.paged === 'true'
  const eventManager = useEventManager()
  try {
    const res = await eventManager.read({ stream: String(name), fromId, limit, direction, paged }) as any
    return res || (paged ? { items: [] } : [])
  }
  catch {
    return []
  }
})
