import { ref, watch, useFetch, type Ref, isRef } from '#imports'
import type { FetchError } from 'ofetch'

export interface FlowRun {
  id: string
  flowName: string
  status: 'running' | 'completed' | 'failed' | 'canceled' | 'stalled' | 'awaiting' | 'unknown'
  createdAt: string
  startedAt?: string
  completedAt?: string
  stepCount: number
  completedSteps: number
}

export interface FlowRunsResponse {
  flowName: string
  count: number
  total: number
  offset: number
  limit: number
  hasMore: boolean
  items: FlowRun[]
}

/**
 * Composable for fetching flow runs with pagination
 * Similar pattern to useTriggerEvents - supports server-side pagination
 * Client-only to avoid hydration mismatches
 */
export function useFlowRuns(
  flowId: Ref<string>,
  options?: Ref<{
    limit?: number
    offset?: number
    status?: string | null
  }> | {
    limit?: number
    offset?: number
    status?: string | null
  },
): {
  runs: Ref<FlowRunsResponse | null | undefined>
  refresh: () => Promise<void>
  status: Ref<'idle' | 'pending' | 'success' | 'error'>
  error: Ref<FetchError | null | undefined>
} {
  // Counter to force cache busting when needed
  const refreshCounter = ref(0)

  // Support both reactive and non-reactive options
  const opts = isRef(options) ? options : ref(options || {})

  const buildUrl = () => {
    if (!flowId.value) return '/api/_flows/__invalid__/runs'

    const params = new URLSearchParams()
    params.append('_t', refreshCounter.value.toString())
    if (opts.value.limit) params.append('limit', opts.value.limit.toString())
    if (opts.value.offset !== undefined) params.append('offset', opts.value.offset.toString())
    if (opts.value.status) params.append('status', opts.value.status)

    return `/api/_flows/${encodeURIComponent(flowId.value)}/runs?${params.toString()}`
  }

  const { data: runs, refresh: _refresh, status, error } = useFetch<FlowRunsResponse>(
    buildUrl,
    {
      immediate: false,
      watch: false, // Disable automatic watch to prevent SSR execution
      server: false, // Client-only to avoid hydration issues
    },
  )

  // Wrapper that increments counter to bust cache
  const refresh = async () => {
    if (!flowId.value) return
    refreshCounter.value++
    await _refresh()
  }

  // Trigger initial fetch if we have a flow (client-only)
  watch(flowId, (newFlow, oldFlow) => {
    if (import.meta.client && newFlow && newFlow !== oldFlow) {
      refresh()
    }
  }, { immediate: true })

  // Watch for options changes - refetch when they change
  watch(() => opts.value, () => {
    if (import.meta.client && flowId.value) {
      refresh()
    }
  }, { deep: true })

  return {
    runs: runs as Ref<FlowRunsResponse | null | undefined>,
    refresh,
    status,
    error,
  }
}
