import { defineEventHandler, getRouterParam, useQueue } from '#imports'

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name') || ''
  const id = getRouterParam(event, 'id') || ''
  const { getJob } = useQueue()
  const job = await getJob(name, id)
  if (!job) return null
  return { ...job, queue: name }
})
