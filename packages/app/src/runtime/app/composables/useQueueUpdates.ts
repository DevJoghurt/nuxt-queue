import { ref, computed, watch, onUnmounted, type Ref } from '#imports'
import type { QueueCounts } from './useQueues'
import { useQueuesWebSocket, type QueueEvent } from './useQueuesWebSocket'

interface QueueState {
  counts: QueueCounts | null
  lastEvent: QueueEvent | null
  countsUpdatedAt: number | null
  shouldRefreshJobs: boolean
}

/**
 * Composable for real-time queue updates
 */
export function useQueueUpdates(queueName: Ref<string>) {
  const queueWs = useQueuesWebSocket()
  const state = ref<QueueState>({
    counts: null,
    lastEvent: null,
    countsUpdatedAt: null,
    shouldRefreshJobs: false,
  })
  let subscriptionId: string | null = null

  const subscribe = (name: string) => {
    if (!import.meta.client || !name) return

    subscriptionId = queueWs.subscribe(
      name,
      (counts) => {
        state.value.counts = counts
        state.value.countsUpdatedAt = Date.now()
      },
      (event) => {
        state.value.lastEvent = event
        if (['waiting', 'active', 'completed', 'failed'].includes(event?.eventType)) {
          state.value.shouldRefreshJobs = true
        }
      },
    )
  }

  // Subscribe to initial queue
  if (import.meta.client && queueName.value) {
    subscribe(queueName.value)
  }

  // Watch for queue name changes
  watch(queueName, (newName, oldName) => {
    if (oldName && subscriptionId) {
      queueWs.unsubscribe(oldName, subscriptionId)
    }
    if (newName) subscribe(newName)
  })

  // Cleanup
  onUnmounted(() => {
    if (queueName.value && subscriptionId) {
      queueWs.unsubscribe(queueName.value, subscriptionId)
    }
  })

  const resetRefreshFlag = () => {
    state.value.shouldRefreshJobs = false
  }

  return {
    isConnected: queueWs.connected,
    isReconnecting: queueWs.reconnecting,
    counts: computed(() => state.value.counts),
    lastEvent: computed(() => state.value.lastEvent),
    countsUpdatedAt: computed(() => state.value.countsUpdatedAt),
    shouldRefreshJobs: computed(() => state.value.shouldRefreshJobs),
    resetRefreshFlag,
  }
}
