import { ref, computed, watch, type Ref } from '#imports'

interface FlowRun {
  id: string
  flowName: string
  status: 'running' | 'completed' | 'failed' | 'canceled' | 'stalled' | 'unknown'
  createdAt: string
  startedAt?: string
  completedAt?: string
  stepCount: number
  completedSteps: number
}

interface FlowRunsResponse {
  flowName: string
  count: number
  total: number
  offset: number
  limit: number
  hasMore: boolean
  items: FlowRun[]
}

/**
 * Composable for infinite scroll flow runs with pagination
 */
export function useFlowRunsInfinite(flowId: Ref<string>) {
  const items = ref<FlowRun[]>([])
  const total = ref(0)
  const offset = ref(0)
  const limit = 50
  const loading = ref(false)
  const hasMore = ref(true)
  const error = ref<Error | null>(null)

  // Track the newest run ID to detect new runs during polling
  const newestRunId = ref<string | null>(null)

  // Reset state when flow changes
  const reset = () => {
    items.value = []
    total.value = 0
    offset.value = 0
    hasMore.value = true
    error.value = null
    newestRunId.value = null
  }

  // Fetch a page of runs
  const fetchPage = async (resetData = false) => {
    if (!flowId.value || loading.value) return

    if (resetData) {
      reset()
    }

    if (!hasMore.value && !resetData) return

    try {
      loading.value = true
      error.value = null

      const response = await $fetch<FlowRunsResponse>(
        `/api/_flows/${encodeURIComponent(flowId.value)}/runs`,
        {
          query: {
            limit,
            offset: resetData ? 0 : offset.value,
            _t: Date.now(), // Cache busting
          },
        },
      )

      if (resetData) {
        items.value = response.items
        offset.value = response.items.length
        // Track the newest run ID
        if (response.items.length > 0) {
          newestRunId.value = response.items[0]!.id
        }
      }
      else {
        items.value.push(...response.items)
        offset.value += response.items.length
      }

      total.value = response.total
      hasMore.value = response.hasMore
    }
    catch (err) {
      console.error('[useFlowRunsInfinite] fetch error:', err)
      error.value = err instanceof Error ? err : new Error(String(err))
    }
    finally {
      loading.value = false
    }
  }

  // Load next page
  const loadMore = () => {
    if (!loading.value && hasMore.value) {
      fetchPage(false)
    }
  }

  // Refresh from the beginning
  const refresh = async () => {
    await fetchPage(true)
  }

  // Check for new runs without resetting scroll position (for polling)
  const checkForNewRuns = async () => {
    if (!flowId.value || loading.value) return

    try {
      const response = await $fetch<FlowRunsResponse>(
        `/api/_flows/${encodeURIComponent(flowId.value)}/runs`,
        {
          query: {
            limit: Math.max(items.value.length, 10), // Fetch at least as many as we have loaded
            offset: 0,
            _t: Date.now(),
          },
        },
      )

      if (response.items.length === 0) return

      const latestRunId = response.items[0]!.id

      // Update metadata for existing runs and add new ones
      const updatedItems = [...items.value]
      const newRuns: FlowRun[] = []

      for (const freshRun of response.items) {
        const existingIndex = updatedItems.findIndex(r => r.id === freshRun.id)

        if (existingIndex >= 0) {
          // Update existing run with fresh metadata
          updatedItems[existingIndex] = freshRun
        }
        else {
          // New run - add to list
          newRuns.push(freshRun)
        }
      }

      // Prepend new runs to the beginning
      if (newRuns.length > 0) {
        items.value = [...newRuns, ...updatedItems]
        newestRunId.value = latestRunId
      }
      else {
        // Just update metadata
        items.value = updatedItems
      }

      total.value = response.total

      if (!newestRunId.value) {
        newestRunId.value = latestRunId
      }
    }
    catch (err) {
      console.error('[useFlowRunsInfinite] checkForNewRuns error:', err)
    }
  }

  // Watch for flow changes
  watch(flowId, (newFlow, oldFlow) => {
    if (import.meta.client && newFlow && newFlow !== oldFlow) {
      refresh()
    }
  }, { immediate: true })

  return {
    items: computed(() => items.value),
    total: computed(() => total.value),
    loading: computed(() => loading.value),
    hasMore: computed(() => hasMore.value),
    error: computed(() => error.value),
    loadMore,
    refresh,
    checkForNewRuns, // For polling - prepends new runs without resetting
    reset,
  }
}
