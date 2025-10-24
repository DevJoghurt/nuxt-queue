import { defineEventHandler, $useQueueRegistry } from '#imports'

export default defineEventHandler(async () => {
  const registry = $useQueueRegistry() as any
  const workers = (registry?.workers || []).map((w: any) => ({
    id: w.id,
    queue: w.queue,
    kind: w.kind,
    runtype: w.runtype || 'inprocess',
    filePath: w.filePath,
  }))
  return workers
})
