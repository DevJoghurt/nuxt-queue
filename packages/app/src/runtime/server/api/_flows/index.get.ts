import { defineEventHandler, $useAnalyzedFlows } from '#imports'

/**
 * Returns pre-analyzed flows from the build-time registry.
 * Flows are analyzed during the build process for optimal performance.
 * Runtime statistics are provided via WebSocket (see ws.ts).
 */
export default defineEventHandler(() => {
  const analyzedFlows = $useAnalyzedFlows()
  return analyzedFlows || []
})
