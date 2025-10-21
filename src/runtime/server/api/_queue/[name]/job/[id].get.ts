import { defineEventHandler, getRouterParam, $useQueueProvider } from '#imports'

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name') || ''
  const id = getRouterParam(event, 'id') || ''
  const provider = $useQueueProvider()
  const job = await provider.getJob(name, id)
  if (!job) return null
  return { ...job, queue: name }
})
