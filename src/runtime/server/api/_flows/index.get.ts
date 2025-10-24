import { defineEventHandler, $useQueueRegistry } from '#imports'

export default defineEventHandler(() => {
  const registry = $useQueueRegistry()
  const flows = registry?.flows || {}
  // Return as an array for UI convenience, without spread typing issues
  return Object.entries(flows).map(([id, meta]: any) => ({
    id,
    entry: meta?.entry,
    steps: meta?.steps,
  }))
})
