import { ref, computed, onUnmounted, type Ref } from '#imports'
import type { QueueCounts } from './useQueues'

interface QueueEvent {
  eventType: 'waiting' | 'active' | 'completed' | 'failed' | 'progress'
  jobId?: string
  [key: string]: any
}

interface QueueState {
  counts: QueueCounts | null
  lastEvent: QueueEvent | null
  countsUpdatedAt: number | null
  shouldRefreshJobs: boolean
}

/**
 * Composable for real-time queue updates via WebSocket
 */
export function useQueueUpdates(queueName: Ref<string>) {
  const ws = ref<WebSocket | null>(null)
  const isConnected = ref(false)
  const isReconnecting = ref(false)
  const state = ref<QueueState>({
    counts: null,
    lastEvent: null,
    countsUpdatedAt: null,
    shouldRefreshJobs: false,
  })

  let reconnectTimeout: NodeJS.Timeout | null = null
  let reconnectAttempts = 0
  const maxReconnectAttempts = 5

  const connect = () => {
    if (!import.meta.client || !queueName.value) return

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
        console.log('[useQueueUpdates] connected')
        isConnected.value = true
        isReconnecting.value = false
        reconnectAttempts = 0

        // Subscribe to queue
        socket.send(JSON.stringify({
          type: 'subscribe',
          queueName: queueName.value,
        }))
      }

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)

          if (message.type === 'event') {
            state.value.lastEvent = message.event

            // Trigger job list refresh for state-changing events
            const eventType = message.event?.eventType
            if (['waiting', 'active', 'completed', 'failed'].includes(eventType)) {
              state.value.shouldRefreshJobs = true
            }
          }
          else if (message.type === 'counts') {
            state.value.counts = message.counts
            state.value.countsUpdatedAt = Date.now()
          }
          else if (message.type === 'error') {
            console.error('[useQueueUpdates] error:', message.message)
          }
        }
        catch (err) {
          console.error('[useQueueUpdates] parse error:', err)
        }
      }

      socket.onerror = (error) => {
        console.error('[useQueueUpdates] error:', error)
      }

      socket.onclose = () => {
        console.log('[useQueueUpdates] disconnected')
        isConnected.value = false

        // Attempt reconnection if not manually closed
        if (reconnectAttempts < maxReconnectAttempts && queueName.value) {
          isReconnecting.value = true
          reconnectAttempts++
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 10000)
          reconnectTimeout = setTimeout(() => {
            console.log(`[useQueueUpdates] reconnecting (attempt ${reconnectAttempts})...`)
            connect()
          }, delay)
        }
        else {
          isReconnecting.value = false
        }
      }
    }
    catch (err) {
      console.error('[useQueueUpdates] connection error:', err)
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
        // Send unsubscribe before closing
        if (ws.value.readyState === WebSocket.OPEN) {
          ws.value.send(JSON.stringify({
            type: 'unsubscribe',
            queueName: queueName.value,
          }))
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
  if (import.meta.client && queueName.value) {
    connect()
  }

  // Cleanup on unmount
  onUnmounted(() => {
    disconnect()
  })

  const resetRefreshFlag = () => {
    state.value.shouldRefreshJobs = false
  }

  return {
    isConnected: computed(() => isConnected.value),
    isReconnecting: computed(() => isReconnecting.value),
    counts: computed(() => state.value.counts),
    lastEvent: computed(() => state.value.lastEvent),
    countsUpdatedAt: computed(() => state.value.countsUpdatedAt),
    shouldRefreshJobs: computed(() => state.value.shouldRefreshJobs),
    resetRefreshFlag,
    connect,
    disconnect,
  }
}
