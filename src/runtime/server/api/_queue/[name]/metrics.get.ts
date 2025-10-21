import { defineEventHandler, getRouterParam, $useQueueProvider } from '#imports'

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name') || ''
  const provider = $useQueueProvider()
  const counts = typeof provider.getJobCounts === 'function' ? await provider.getJobCounts(name) : undefined
  const paused = typeof provider.isPaused === 'function' ? await provider.isPaused(name) : undefined
  return { name, counts, paused }
})
