import { analyzedFlows } from '#build/analyzed-flows'
import type { AnalyzedFlows } from '#build/analyzed-flows'
import { readonly, ref } from '#imports'

/**
 * Get pre-analyzed flows with execution levels and dependencies.
 * Flows are analyzed at build time for optimal performance.
 *
 * This returns a reactive ref that will automatically trigger re-renders
 * when flows are updated during development.
 */
export function useAnalyzedFlows() {
  return readonly(ref(analyzedFlows))
}

/**
 * Get the raw analyzed flows array directly.
 * Use this when you don't need reactivity.
 */
export function getAnalyzedFlows(): AnalyzedFlows {
  return analyzedFlows
}
