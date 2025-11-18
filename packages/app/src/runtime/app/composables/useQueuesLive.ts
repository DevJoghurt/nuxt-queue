import { ref, computed, watch, onUnmounted, type Ref } from '#imports'
import type { QueueInfo, QueueCounts } from './useQueues'
import { useQueuesWebSocket } from './useQueuesWebSocket'

/**
 * Composable for live queue updates across all queues
 */
export function useQueuesLive(queues: Ref<QueueInfo[] | null | undefined>) {
  const queueWs = useQueuesWebSocket()
  const liveCounts = ref<Record<string, QueueCounts>>({})
  const subscriptionIds = new Map<string, string>()

  const subscribeToQueues = (queueNames: string[]) => {
    for (const queueName of queueNames) {
      if (!subscriptionIds.has(queueName)) {
        const id = queueWs.subscribe(
          queueName,
          (counts) => {
            liveCounts.value[queueName] = counts
          },
        )
        subscriptionIds.set(queueName, id)
      }
    }
  }

  const unsubscribeFromQueues = (queueNames: string[]) => {
    for (const queueName of queueNames) {
      const id = subscriptionIds.get(queueName)
      if (id) {
        queueWs.unsubscribe(queueName, id)
        subscriptionIds.delete(queueName)
      }
    }
  }

  // Subscribe to initial queues
  if (import.meta.client && queues.value) {
    subscribeToQueues(queues.value.map(q => q.name))
  }

  // Watch for queue list changes
  watch(
    () => queues.value,
    (newQueues, oldQueues) => {
      if (!newQueues) return

      const oldNames = new Set(oldQueues?.map(q => q.name) || [])
      const newNames = newQueues.map(q => q.name)
      const toSubscribe = newNames.filter(name => !oldNames.has(name))
      const toUnsubscribe = Array.from(oldNames).filter(name => !newNames.includes(name))

      if (toUnsubscribe.length > 0) unsubscribeFromQueues(toUnsubscribe)
      if (toSubscribe.length > 0) subscribeToQueues(toSubscribe)
    },
  )

  // Cleanup
  onUnmounted(() => {
    if (queues.value) {
      unsubscribeFromQueues(queues.value.map(q => q.name))
    }
  })

  const queuesWithLiveCounts = computed(() => {
    if (!queues.value) return null
    return queues.value.map(queue => ({
      ...queue,
      counts: liveCounts.value[queue.name] || queue.counts,
    }))
  })

  return {
    queues: queuesWithLiveCounts,
    isConnected: queueWs.connected,
    isReconnecting: queueWs.reconnecting,
    liveCounts,
  }
}
