import { defineEventHandler, $useQueueRegistry, $useQueueProvider, useRuntimeConfig } from '#imports'

export default defineEventHandler(async () => {
  const registry = $useQueueRegistry() as any
  const provider = $useQueueProvider()
  const rc: any = useRuntimeConfig()
  const cfgQueues = rc?.queue?.queues || {}

  const names = new Set<string>()
  for (const q in cfgQueues) names.add(q)
  if (registry?.workers?.length) {
    for (const w of registry.workers as Array<{ queue: string }>) names.add(w.queue)
  }

  const result: Record<string, { paused?: boolean, counts?: Record<string, number> }> = {}
  for (const name of names) {
    const counts = typeof provider.getJobCounts === 'function' ? await provider.getJobCounts(name) : undefined
    const paused = typeof provider.isPaused === 'function' ? await provider.isPaused(name) : undefined
    result[name] = { counts, paused }
  }

  return result
})
