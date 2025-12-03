import { ref, type Ref, useFetch, isRef } from '#imports'
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
  count: number
  total: number
  hasMore: boolean
}

/**
 * Composable for fetching jobs for a queue
 * Client-only to avoid hydration mismatches
 */
export function useQueueJobs(
  queueName: Ref<string>,
  options?: Ref<{
    state?: string | null
    limit?: number
    offset?: number
  }> | {
    state?: string | null
    limit?: number
    offset?: number
  },
): {
  data: Ref<JobsResponse | null | undefined>
  refresh: () => Promise<void>
  status: Ref<'idle' | 'pending' | 'success' | 'error'>
  error: Ref<FetchError | null | undefined>
} {
  // Support both reactive and non-reactive options
  const opts = isRef(options) ? options : ref(options || {})

  return useFetch<JobsResponse>(
    () => {
      const params = new URLSearchParams()
      if (opts.value.state) {
        params.append('state', opts.value.state)
      }
      if (opts.value.limit) {
        params.append('limit', opts.value.limit.toString())
      }
      if (opts.value.offset) {
        params.append('offset', opts.value.offset.toString())
      }
      const queryString = params.toString()
      return `/api/_queues/${encodeURIComponent(queueName.value)}/job${queryString ? `?${queryString}` : ''}`
    },
    {
      key: () => `queue-jobs-${queueName.value}-${opts.value.state || 'all'}-${opts.value.offset || 0}`,
      watch: false,
      immediate: true,
      server: false,
    },
  )
}
