import { defineEventHandler, getRouterParam, useQueueAdapter } from '#imports'

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name') || ''
  const id = getRouterParam(event, 'id') || ''

  // Check if adapters are initialized
  let queue: any
  try {
    queue = useQueueAdapter()
  }
  catch {
    return null
  }
  const job = await queue.getJob(name, id)
  if (!job) return null
  return { ...job, queue: name }
})
