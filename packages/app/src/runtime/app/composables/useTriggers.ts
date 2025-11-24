import { ref, useFetch, type Ref } from '#imports'
import type { FetchError } from 'ofetch'

export interface TriggerStats {
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

export interface TriggerInfo {
  name: string
  type: 'event' | 'webhook' | 'schedule' | 'manual'
  scope: 'flow' | 'run'
  displayName?: string
  description?: string
  source?: string
  status: 'active' | 'inactive' | 'retired'
  registeredAt?: number
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
  subscribedFlows: string[]
  subscriptionCount: number
  stats: TriggerStats
}

export interface TriggerStatsOverview {
  total: number
  active: number
  inactive: number
  retired: number
  byType: Record<string, number>
  byScope: Record<string, number>
  byStatus: Record<string, number>
  totalSubscriptions: number
  totalFires: number
  withSubscribers: number
}

/**
 * Composable for fetching trigger list
 */
export function useTriggers(): {
  triggers: Ref<TriggerInfo[] | null | undefined>
  refresh: () => Promise<void>
  status: Ref<'idle' | 'pending' | 'success' | 'error'>
  error: Ref<FetchError | null | undefined>
} {
  const refreshCounter = ref(0)

  const { data: triggers, refresh: _refresh, status, error } = useFetch<TriggerInfo[]>(
    () => `/api/_triggers?_t=${refreshCounter.value}`,
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
    triggers,
    refresh,
    status,
    error,
  }
}

/**
 * Composable for fetching aggregate trigger statistics
 */
export function useTriggersStats(): {
  stats: Ref<TriggerStatsOverview | null | undefined>
  refresh: () => Promise<void>
  status: Ref<'idle' | 'pending' | 'success' | 'error'>
  error: Ref<FetchError | null | undefined>
} {
  const refreshCounter = ref(0)

  const { data: stats, refresh: _refresh, status, error } = useFetch<TriggerStatsOverview>(
    () => `/api/_triggers/stats?_t=${refreshCounter.value}`,
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
    stats,
    refresh,
    status,
    error,
  }
}
