import { defineEventHandler, useRuntimeConfig, getRouterParam, $useQueueRegistry } from '#imports'

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name') || ''

  const rc: any = useRuntimeConfig()
  const cfgQueues = rc?.queue?.queues || {}
  const registry = $useQueueRegistry() as any
  const exists = cfgQueues[name] || (registry?.workers || []).some((w: any) => w.queue === name)
  if (!exists) {
    throw `Queue with ${name} not found`
  }
  return {
    name,
    origin: cfgQueues[name]?.origin,
  }
})
