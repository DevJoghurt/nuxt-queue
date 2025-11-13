import { ref, type Ref, useFetch } from '#imports'
import type { FetchError } from 'ofetch'

export interface Job {
  id: string
  name: string
  data: any
  state?: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'paused'
  returnvalue?: any
  failedReason?: string
  timestamp?: number
  processedOn?: number
  finishedOn?: number
}

export interface JobsResponse {
  jobs: Job[]
}

/**
 * Composable for fetching jobs for a queue
 * Client-only to avoid hydration mismatches
 */
export function useQueueJobs(
  queueName: Ref<string>,
  state: Ref<string | null> = ref(null),
): {
  data: Ref<JobsResponse | null | undefined>
  refresh: () => Promise<void>
  status: Ref<'idle' | 'pending' | 'success' | 'error'>
  error: Ref<FetchError | null | undefined>
} {
  return useFetch<JobsResponse>(
    () => {
      const params = new URLSearchParams()
      if (state.value) {
        params.append('state', state.value)
      }
      const queryString = params.toString()
      return `/api/_queues/${encodeURIComponent(queueName.value)}/job${queryString ? `?${queryString}` : ''}`
    },
    {
      key: () => `queue-jobs-${queueName.value}-${state.value || 'all'}`,
      watch: [queueName, state],
      immediate: true,
      server: false, // Client-only
    },
  )
}
