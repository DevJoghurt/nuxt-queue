import { ref, watch, useFetch, type Ref } from '#imports'
import type { FetchError } from 'ofetch'

interface FlowRun {
  id: string
  [key: string]: any
}

/**
 * Composable for fetching and managing flow runs
 * Simple approach: Fresh fetch on every refresh, no stale cache
 * Client-only to avoid hydration mismatches
 */
export function useFlowRuns(flowId: Ref<string>): {
  runs: Ref<FlowRun[] | null | undefined>
  refresh: () => Promise<void>
  status: Ref<'idle' | 'pending' | 'success' | 'error'>
  error: Ref<FetchError | null | undefined>
} {
  // Counter to force cache busting when needed
  const refreshCounter = ref(0)

  const { data: runs, refresh: _refresh, status, error } = useFetch(
    () => `/api/_flows/${encodeURIComponent(flowId.value)}/runs?_t=${refreshCounter.value}`,
    {
      immediate: false,
      watch: false, // Disable automatic watch to prevent SSR execution
      server: false, // Client-only to avoid hydration issues
      // Don't use a key - this prevents Nuxt from caching across calls
    },
  )

  // Wrapper that increments counter to bust cache
  const refresh = async () => {
    refreshCounter.value++
    await _refresh()
  }

  // Trigger initial fetch if we have a flow (client-only)
  watch(flowId, (newFlow, oldFlow) => {
    if (import.meta.client && newFlow) {
      // Always refresh when flow changes or on initial mount
      if (newFlow !== oldFlow || !runs.value) {
        refresh()
      }
    }
  }, { immediate: true })

  return {
    runs,
    refresh,
    status,
    error,
  }
}
