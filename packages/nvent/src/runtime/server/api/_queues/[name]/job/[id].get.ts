import { defineEventHandler, getRouterParam, useQueueAdapter } from '#imports'

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name') || ''
  const id = getRouterParam(event, 'id') || ''
  const queue = useQueueAdapter()
  const job = await queue.getJob(name, id)
  if (!job) return null
  return { ...job, queue: name }
})
