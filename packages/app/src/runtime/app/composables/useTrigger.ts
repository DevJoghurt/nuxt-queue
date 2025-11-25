import { ref, useFetch, type Ref, isRef } from '#imports'
import type { FetchError } from 'ofetch'

export interface TriggerDetail {
  name: string
  type: 'event' | 'webhook' | 'schedule' | 'manual'
  scope: 'flow' | 'run'
  displayName?: string
  description?: string
  source?: string
  status: 'active' | 'inactive' | 'retired'
  registeredAt?: number
  registeredBy?: string
  lastActivityAt?: number
  webhook?: {
    path: string
    method?: string
    auth?: any
  }
  schedule?: {
    cron: string
    timezone?: string
    enabled?: boolean
  }
  config?: any
  version?: number
  subscribedFlows: string[]
  subscriptions: Array<{
    triggerName: string
    flowName: string
    mode: 'auto' | 'manual'
    source: string
    registeredAt?: number
  }>
  subscriptionCount: number
  stats: {
    totalFires: number
    successCount: number
    failureCount: number
    last24h: number
    last7d?: number
    last30d?: number
    activeSubscribers: number
    avgResponseTime?: number
    successRate?: number
  }
}

export interface TriggerEvent {
  type: string
  timestamp: number
  data: any
  triggerName?: string
  [key: string]: any
}

export interface TriggerEventsResponse {
  triggerName: string
  events: TriggerEvent[]
  count: number
  total: number // Total count for pagination
  hasMore: boolean
}

/**
 * Composable for fetching trigger detail
 */
export function useTrigger(
  name: Ref<string | null>,
): {
  trigger: Ref<TriggerDetail | null | undefined>
  refresh: () => Promise<void>
  status: Ref<'idle' | 'pending' | 'success' | 'error'>
  error: Ref<FetchError | null | undefined>
} {
  const refreshCounter = ref(0)

  const { data: trigger, refresh: _refresh, status, error } = useFetch<TriggerDetail>(
    () => {
      if (!name.value) return null
      return `/api/_triggers/${encodeURIComponent(name.value)}?_t=${refreshCounter.value}`
    },
    {
      immediate: false,
      watch: false,
      server: false, // Client-only
      default: () => null as TriggerDetail | null,
    },
  )

  // Wrapper that increments counter to bust cache
  const refresh = async () => {
    if (!name.value) return
    refreshCounter.value++
    await _refresh()
  }

  // Trigger initial fetch on client
  if (import.meta.client && name.value) {
    refresh()
  }

  return {
    trigger,
    refresh,
    status,
    error,
  }
}

/**
 * Composable for fetching trigger events
 */
export function useTriggerEvents(
  name: Ref<string | null>,
  options?: Ref<{
    limit?: number
    offset?: number
    types?: string[]
  }> | {
    limit?: number
    offset?: number
    types?: string[]
  },
): {
  events: Ref<TriggerEventsResponse | null | undefined>
  refresh: () => Promise<void>
  status: Ref<'idle' | 'pending' | 'success' | 'error'>
  error: Ref<FetchError | null | undefined>
} {
  const refreshCounter = ref(0)

  // Support both reactive and non-reactive options
  const opts = isRef(options) ? options : ref(options || {})

  const buildUrl = () => {
    if (!name.value) return '/api/_triggers/null/events'

    const params = new URLSearchParams()
    params.append('_t', refreshCounter.value.toString())
    if (opts.value.limit) params.append('limit', opts.value.limit.toString())
    if (opts.value.offset) params.append('offset', opts.value.offset.toString())
    if (opts.value.types) params.append('types', opts.value.types.join(','))

    return `/api/_triggers/${encodeURIComponent(name.value)}/events?${params.toString()}`
  }

  const { data: events, refresh: _refresh, status, error } = useFetch<TriggerEventsResponse>(
    buildUrl,
    {
      immediate: false,
      watch: false,
      server: false, // Client-only
      default: () => null as TriggerEventsResponse | null,
    },
  )

  // Wrapper that increments counter to bust cache
  const refresh = async () => {
    if (!name.value) return
    refreshCounter.value++
    await _refresh()
  }

  // Trigger initial fetch on client
  if (import.meta.client && name.value) {
    refresh()
  }

  return {
    events,
    refresh,
    status,
    error,
  }
}
