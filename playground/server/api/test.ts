export default defineEventHandler((_event) => {
  const registry = $useQueueRegistry?.()
  return registry || {}
})
