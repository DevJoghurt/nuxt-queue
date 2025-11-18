import { ref, computed, watch, onUnmounted, type Ref } from '#imports'
import type { QueueInfo, QueueCounts } from './useQueues'

/**
 * Composable for live queue updates across all queues
 * Subscribes to WebSocket updates for multiple queues
 */
export function useQueuesLive(queues: Ref<QueueInfo[] | null | undefined>) {
  const ws = ref<WebSocket | null>(null)
  const isConnected = ref(false)
  const isReconnecting = ref(false)

  // Map of queueName -> counts
  const liveCounts = ref<Record<string, QueueCounts>>({})

  let reconnectTimeout: NodeJS.Timeout | null = null
  let reconnectAttempts = 0
  const maxReconnectAttempts = 5

  const safeSend = (data: any): boolean => {
    if (!ws.value || ws.value.readyState !== WebSocket.OPEN) return false
    try {
      ws.value.send(JSON.stringify(data))
      return true
    }
    catch {
      return false
    }
  }

  const subscribeToQueues = (queueNames: string[]) => {
    if (!ws.value || ws.value.readyState !== WebSocket.OPEN) return

    for (const queueName of queueNames) {
      safeSend({
        type: 'subscribe',
        queueName,
      })
    }
  }

  const connect = () => {
    if (!import.meta.client) return

    // Close existing connection
    if (ws.value) {
      try {
        ws.value.close()
      }
      catch {
        // Ignore
      }
      ws.value = null
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/api/_queues/ws`

    try {
      const socket = new WebSocket(wsUrl)
      ws.value = socket

      socket.onopen = () => {
        console.log('[useQueuesLive] connected')
        isConnected.value = true
        isReconnecting.value = false
        reconnectAttempts = 0

        // Subscribe to all current queues
        if (queues.value) {
          const queueNames = queues.value.map(q => q.name)
          subscribeToQueues(queueNames)
        }
      }

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)

          if (message.type === 'counts' && message.queueName) {
            liveCounts.value[message.queueName] = message.counts
          }
          else if (message.type === 'error') {
            console.error('[useQueuesLive] error:', message.message)
          }
        }
        catch (err) {
          console.error('[useQueuesLive] parse error:', err)
        }
      }

      socket.onerror = (error) => {
        console.error('[useQueuesLive] error:', error)
      }

      socket.onclose = () => {
        console.log('[useQueuesLive] disconnected')
        isConnected.value = false

        // Attempt reconnection
        if (reconnectAttempts < maxReconnectAttempts) {
          isReconnecting.value = true
          reconnectAttempts++
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 10000)
          reconnectTimeout = setTimeout(() => {
            console.log(`[useQueuesLive] reconnecting (attempt ${reconnectAttempts})...`)
            connect()
          }, delay)
        }
        else {
          isReconnecting.value = false
        }
      }
    }
    catch (err) {
      console.error('[useQueuesLive] connection error:', err)
      isConnected.value = false
    }
  }

  const disconnect = () => {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout)
      reconnectTimeout = null
    }

    if (ws.value) {
      try {
        // Unsubscribe from all queues
        if (queues.value) {
          for (const queue of queues.value) {
            safeSend({
              type: 'unsubscribe',
              queueName: queue.name,
            })
          }
        }
        ws.value.close()
      }
      catch {
        // Ignore
      }
      ws.value = null
    }

    isConnected.value = false
    isReconnecting.value = false
  }

  // Connect on mount
  if (import.meta.client) {
    connect()
  }

  // Watch for queue list changes and subscribe to new queues
  watch(
    () => queues.value,
    (newQueues, oldQueues) => {
      if (!newQueues || !ws.value || ws.value.readyState !== WebSocket.OPEN) return

      const oldNames = new Set(oldQueues?.map(q => q.name) || [])
      const newNames = newQueues.map(q => q.name)
      const toSubscribe = newNames.filter(name => !oldNames.has(name))

      if (toSubscribe.length > 0) {
        subscribeToQueues(toSubscribe)
      }
    },
  )

  // Cleanup on unmount
  onUnmounted(() => {
    disconnect()
  })

  // Merge live counts with static queue data
  const queuesWithLiveCounts = computed(() => {
    if (!queues.value) return null

    return queues.value.map(queue => ({
      ...queue,
      counts: liveCounts.value[queue.name] || queue.counts,
    }))
  })

  return {
    queues: queuesWithLiveCounts,
    isConnected: computed(() => isConnected.value),
    isReconnecting: computed(() => isReconnecting.value),
    liveCounts: computed(() => liveCounts.value),
    connect,
    disconnect,
  }
}
