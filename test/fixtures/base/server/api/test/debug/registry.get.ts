import { $useQueueRegistry } from '#imports'

export default defineEventHandler(async () => {
  const registry = $useQueueRegistry()

  return {
    hasFlows: !!registry?.flows,
    flowCount: registry?.flows ? Object.keys(registry.flows).length : 0,
    flows: registry?.flows || {},
    workerCount: registry?.workers?.length || 0,
    workers: (registry?.workers || []).map((w: any) => ({
      id: w.id,
      queue: w.queue?.name,
      flow: w.flow,
    })),
  }
})
