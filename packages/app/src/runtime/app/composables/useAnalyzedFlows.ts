import { analyzedFlows } from '#build/analyzed-flows'
import type { AnalyzedFlows } from '#build/analyzed-flows'
import { readonly, ref, computed } from '#imports'

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

/**
 * Get analyzed flows with flattened structure for UI consumption.
 * Merges analyzed properties to top level for easier access.
 */
export function useFlattenedAnalyzedFlows() {
  return computed(() => {
    return analyzedFlows.map((flow: any) => ({
      id: flow.id,
      entry: flow.entry,
      steps: flow.analyzed?.steps || flow.steps || {},
      levels: flow.analyzed?.levels || [],
      maxLevel: flow.analyzed?.maxLevel || 0,
      stallTimeout: flow.analyzed?.stallTimeout,
      awaitPatterns: flow.analyzed?.awaitPatterns,
      hasAwait: flow.analyzed?.awaitPatterns?.steps?.length > 0 || false,
    }))
  })
}
