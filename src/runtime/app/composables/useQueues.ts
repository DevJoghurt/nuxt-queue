import { ref } from '#imports'

export interface QueueCounts {
  active: number
  completed: number
  failed: number
  delayed: number
  waiting: number
  paused: number
}

export interface QueueInfo {
  name: string
  counts: QueueCounts
  isPaused: boolean
}

/**
 * Composable for fetching queue list with job counts
 * Client-only to avoid hydration mismatches
 */
export function useQueues() {
  const refreshCounter = ref(0)

  const { data: queues, refresh: _refresh, status, error } = useFetch<QueueInfo[]>(
    () => `/api/_queues?_t=${refreshCounter.value}`,
    {
      immediate: false,
      watch: false,
      server: false, // Client-only
    },
  )

  // Wrapper that increments counter to bust cache
  const refresh = async () => {
    refreshCounter.value++
    await _refresh()
  }

  // Trigger initial fetch on client
  if (import.meta.client) {
    refresh()
  }

  return {
    queues,
    refresh,
    status,
    error,
  }
}
