import { defineEventHandler, $useAnalyzedFlows } from '#imports'

/**
 * Returns pre-analyzed flows from the build-time registry.
 * Flows are analyzed during the build process for optimal performance.
 */
export default defineEventHandler(() => {
  const flows = $useAnalyzedFlows() as any
  return flows || []
})
