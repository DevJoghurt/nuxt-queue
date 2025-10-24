import { defineEventHandler, $useQueueRegistry } from '#imports'

export default defineEventHandler(() => {
  const registry = $useQueueRegistry()
  return registry || {}
})
