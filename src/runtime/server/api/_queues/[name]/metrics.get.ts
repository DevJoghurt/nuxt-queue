import { defineEventHandler, getRouterParam, useQueue } from '#imports'

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name') || ''
  const queue = useQueue()
  const counts = typeof queue.getJobCounts === 'function' ? await queue.getJobCounts(name) : undefined
  const paused = typeof queue.isPaused === 'function' ? await queue.isPaused(name) : undefined
  return { name, counts, paused }
})
