import { $useQueueRegistry, defineEventHandler } from '#imports'

export default defineEventHandler((_event) => {
  const registry = $useQueueRegistry?.()
  return registry || {}
})
