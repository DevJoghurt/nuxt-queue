import { defineEventHandler, getRouterParam, $useQueueRegistry } from '#imports'

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name') || ''
  const registry = $useQueueRegistry() as any
  const res = (registry?.workers || []).filter((w: any) => w.queue === name)
    .map((w: any) => ({ id: w.id, queue: w.queue, kind: w.kind, runtype: w.runtype || 'inprocess', filePath: w.filePath }))
  return res
})
