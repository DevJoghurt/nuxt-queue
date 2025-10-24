import { defineEventHandler, useRuntimeConfig, $useQueueRegistry } from '#imports'

export default defineEventHandler(async () => {
  const rc: any = useRuntimeConfig()
  const cfgQueues = (rc?.queue?.queues || {}) as Record<string, any>
  const registry = $useQueueRegistry() as any
  const names = new Set<string>()
  for (const q in cfgQueues) names.add(q)
  if (registry?.workers?.length) {
    for (const w of registry.workers as Array<{ queue: string }>) names.add(w.queue)
  }
  // Minimal, provider-agnostic response
  return Array.from(names).map(name => ({
    name,
    origin: cfgQueues[name]?.origin,
  }))
})
