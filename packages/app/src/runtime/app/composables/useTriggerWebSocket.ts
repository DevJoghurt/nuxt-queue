import { ref, onMounted, onUnmounted, watch, type Ref } from '#imports'

interface TriggerEventMessage {
  type: 'event'
  triggerName: string
  event: any
}

interface TriggerHistoryMessage {
  type: 'history'
  triggerName: string
  events: any[]
}

interface TriggerSubscribedMessage {
  type: 'subscribed'
  triggerName: string
}

interface TriggerUnsubscribedMessage {
  type: 'unsubscribed'
  triggerName: string
}

interface TriggerErrorMessage {
  type: 'error'
  message: string
}

type TriggerWebSocketMessage
  = | TriggerEventMessage
    | TriggerHistoryMessage
    | TriggerSubscribedMessage
    | TriggerUnsubscribedMessage
    | TriggerErrorMessage
    | { type: 'connected' | 'pong', timestamp: number }

/**
 * Composable for managing WebSocket connection to trigger events
 */
export function useTriggerWebSocket(triggerName: Ref<string | null>) {
  const ws = ref<WebSocket | null>(null)
  const isConnected = ref(false)
  const isReconnecting = ref(false)
  const events = ref<any[]>([])
  const error = ref<string | null>(null)

  let reconnectTimeout: NodeJS.Timeout | null = null
  let pingInterval: NodeJS.Timeout | null = null
  let currentTriggerName: string | null = null

  const connect = () => {
    if (import.meta.server) return

    // Close existing connection if any
    cleanup()

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/api/_triggers/ws`

    try {
      ws.value = new WebSocket(wsUrl)

      ws.value.onopen = () => {
        isConnected.value = true
        isReconnecting.value = false
        error.value = null

        // Subscribe to trigger if name is set
        if (triggerName.value) {
          subscribe(triggerName.value)
        }

        // Start ping interval
        startPingInterval()
      }

      ws.value.onmessage = (event) => {
        try {
          const message: TriggerWebSocketMessage = JSON.parse(event.data)

          if (message.type === 'event') {
            // New event from trigger stream
            events.value.unshift(message.event)
            // Keep only last 100 events in memory
            if (events.value.length > 100) {
              events.value = events.value.slice(0, 100)
            }
          }
          else if (message.type === 'history') {
            // Historical events (backfill)
            events.value = [...message.events]
          }
          else if (message.type === 'error') {
            error.value = message.message
          }
        }
        catch (err) {
          console.error('[trigger-ws] Failed to parse message:', err)
        }
      }

      ws.value.onerror = (event) => {
        console.error('[trigger-ws] WebSocket error:', event)
        error.value = 'Connection error'
      }

      ws.value.onclose = () => {
        isConnected.value = false
        stopPingInterval()

        // Attempt to reconnect after 2 seconds
        if (!isReconnecting.value) {
          isReconnecting.value = true
          reconnectTimeout = setTimeout(() => {
            connect()
          }, 2000)
        }
      }
    }
    catch (err) {
      console.error('[trigger-ws] Failed to create WebSocket:', err)
      error.value = 'Failed to connect'
    }
  }

  const subscribe = (name: string) => {
    if (!ws.value || ws.value.readyState !== WebSocket.OPEN) return

    currentTriggerName = name
    events.value = [] // Clear old events

    ws.value.send(
      JSON.stringify({
        type: 'subscribe',
        triggerName: name,
      }),
    )
  }

  const unsubscribe = (name: string) => {
    if (!ws.value || ws.value.readyState !== WebSocket.OPEN) return

    ws.value.send(
      JSON.stringify({
        type: 'unsubscribe',
        triggerName: name,
      }),
    )

    if (currentTriggerName === name) {
      currentTriggerName = null
      events.value = []
    }
  }

  const startPingInterval = () => {
    stopPingInterval()
    pingInterval = setInterval(() => {
      if (ws.value && ws.value.readyState === WebSocket.OPEN) {
        ws.value.send(JSON.stringify({ type: 'ping' }))
      }
    }, 30000) // Ping every 30 seconds
  }

  const stopPingInterval = () => {
    if (pingInterval) {
      clearInterval(pingInterval)
      pingInterval = null
    }
  }

  const cleanup = () => {
    stopPingInterval()

    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout)
      reconnectTimeout = null
    }

    if (ws.value) {
      // Remove event listeners to prevent memory leaks
      ws.value.onopen = null
      ws.value.onmessage = null
      ws.value.onerror = null
      ws.value.onclose = null

      if (ws.value.readyState === WebSocket.OPEN || ws.value.readyState === WebSocket.CONNECTING) {
        ws.value.close()
      }
      ws.value = null
    }

    isConnected.value = false
    isReconnecting.value = false
    currentTriggerName = null
  }

  // Watch trigger name changes
  watch(triggerName, (newName, oldName) => {
    if (oldName && oldName !== newName) {
      unsubscribe(oldName)
    }

    if (newName && newName !== oldName) {
      if (isConnected.value) {
        subscribe(newName)
      }
    }
  })

  onMounted(() => {
    connect()
  })

  onUnmounted(() => {
    cleanup()
  })

  return {
    isConnected,
    isReconnecting,
    events,
    error,
    subscribe,
    unsubscribe,
  }
}
