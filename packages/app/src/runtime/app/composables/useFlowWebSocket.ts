import { ref, onBeforeUnmount } from '#imports'

export interface UseFlowWebSocketOptions {
  autoReconnect?: boolean
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  onOpen?: () => void
  onError?: (err?: any) => void
  onClose?: (event?: CloseEvent) => void
}

export interface FlowSubscription {
  flowName: string
  runId: string
  onEvent: (event: any) => void
  onHistory?: (events: any[]) => void
}

/**
 * WebSocket composable for flow run events
 * Replaces the SSE-based useEventSSE with a more reliable WebSocket implementation
 */
export function useFlowWebSocket() {
  const ws = ref<WebSocket | null>(null)
  const connected = ref(false)
  const reconnecting = ref(false)
  let retry = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let currentOptions: UseFlowWebSocketOptions | undefined
  let currentSubscription: FlowSubscription | null = null
  let pingInterval: ReturnType<typeof setInterval> | null = null
  let isServerRestarting = false

  const computeDelay = (opts?: UseFlowWebSocketOptions) => {
    const base = Math.max(100, opts?.baseDelayMs ?? 1000)
    const max = Math.max(base, opts?.maxDelayMs ?? 10_000)
    // Exponential backoff with jitter
    const exp = Math.min(max, base * Math.pow(2, retry))
    const jitter = Math.floor(Math.random() * Math.min(1000, exp / 4))
    return exp + jitter
  }

  const clearTimers = () => {
    if (reconnectTimer) {
      try {
        clearTimeout(reconnectTimer)
      }
      catch {
        // ignore
      }
      reconnectTimer = null
    }

    if (pingInterval) {
      try {
        clearInterval(pingInterval)
      }
      catch {
        // ignore
      }
      pingInterval = null
    }
  }

  const send = (data: any) => {
    if (ws.value && ws.value.readyState === WebSocket.OPEN) {
      ws.value.send(JSON.stringify(data))
    }
  }

  const startPingInterval = () => {
    clearTimers()
    // Send ping every 30 seconds to keep connection alive
    pingInterval = setInterval(() => {
      if (ws.value && ws.value.readyState === WebSocket.OPEN) {
        send({ type: 'ping' })
      }
    }, 30000)
  }

  const stop = () => {
    clearTimers()
    isServerRestarting = false
    try {
      if (ws.value) {
        ws.value.close(1000, 'Client closing')
      }
    }
    catch (err) {
      console.warn('[useFlowWebSocket] Error closing WebSocket:', err)
    }
    ws.value = null
    connected.value = false
    reconnecting.value = false
    retry = 0
    currentSubscription = null
  }

  const attemptReconnect = () => {
    if (!currentOptions?.autoReconnect) {
      stop()
      return
    }

    const max = Math.max(0, currentOptions?.maxRetries ?? 10)
    if (retry >= max) {
      console.error('[useFlowWebSocket] Max retries reached')
      stop()
      return
    }

    retry++
    reconnecting.value = true

    // If server is restarting, wait longer before reconnecting
    // This gives Nitro time to fully shut down and restart
    const baseDelay = isServerRestarting ? 2000 : computeDelay(currentOptions)
    const delay = baseDelay

    console.log(`[useFlowWebSocket] Will attempt reconnection in ${delay}ms (attempt ${retry}/${max})${isServerRestarting ? ' [server restart]' : ''}`)

    clearTimers()
    reconnectTimer = setTimeout(() => {
      if (currentSubscription) {
        innerSubscribe(currentSubscription, currentOptions)
      }
    }, delay)
  }

  const setupWebSocket = (socket: WebSocket, subscription: FlowSubscription, opts?: UseFlowWebSocketOptions) => {
    socket.onopen = () => {
      console.log('[useFlowWebSocket] Connected')
      connected.value = true
      reconnecting.value = false
      retry = 0

      // Start ping interval
      startPingInterval()

      // Send subscription message
      send({
        type: 'subscribe',
        flowName: subscription.flowName,
        runId: subscription.runId,
      })

      opts?.onOpen?.()
    }

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)

        switch (data.type) {
          case 'connected':
            console.log('[useFlowWebSocket] Server acknowledged connection')
            break

          case 'subscribed':
            console.log('[useFlowWebSocket] Subscribed to flow:', data.flowName, data.runId)
            break

          case 'unsubscribed':
            console.log('[useFlowWebSocket] Unsubscribed from flow:', data.flowName, data.runId)
            break

          case 'history':
            if (subscription.onHistory) {
              subscription.onHistory(data.events)
            }
            else {
              // If no onHistory handler, treat as individual events
              for (const eventData of data.events) {
                subscription.onEvent(eventData)
              }
            }
            break

          case 'event':
            subscription.onEvent(data.event)
            break

          case 'pong':
            // Keep-alive response
            break

          case 'server-restart':
            console.log('[useFlowWebSocket] Server is restarting (HMR)')
            // Mark that server is restarting so we wait longer before reconnecting
            isServerRestarting = true
            break

          case 'error':
            console.error('[useFlowWebSocket] Server error:', data.message)
            opts?.onError?.(new Error(data.message))
            break

          default:
            console.warn('[useFlowWebSocket] Unknown message type:', data.type)
        }
      }
      catch (err) {
        console.error('[useFlowWebSocket] Error parsing message:', err)
      }
    }

    socket.onerror = (err) => {
      console.error('[useFlowWebSocket] WebSocket error:', err)
      opts?.onError?.(err)
    }

    socket.onclose = (event) => {
      console.log('[useFlowWebSocket] Connection closed:', event.code, event.reason)
      connected.value = false
      clearTimers()
      opts?.onClose?.(event)

      // Attempt reconnection for abnormal closures or server restarts
      // 1000 = normal closure (user initiated)
      // 1001 = going away (server restart/HMR) - should reconnect
      // 1006 = abnormal closure - should reconnect
      const shouldReconnect = event.code !== 1000 && opts?.autoReconnect
      if (shouldReconnect) {
        console.log('[useFlowWebSocket] Will attempt reconnection (code:', event.code, ')')
        attemptReconnect()
      }
      else {
        // Reset server restart flag on normal closure
        isServerRestarting = false
      }
    }
  }

  const innerSubscribe = (subscription: FlowSubscription, opts?: UseFlowWebSocketOptions) => {
    // WebSocket is only available in the browser
    if (import.meta.server || typeof WebSocket === 'undefined') {
      console.warn('[useFlowWebSocket] WebSocket not available (SSR context)')
      return
    }

    if (ws.value) {
      stop()
    }

    currentOptions = opts
    currentSubscription = subscription

    try {
      // Construct WebSocket URL
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = `${protocol}//${window.location.host}/api/_flows/ws`

      const socket = new WebSocket(wsUrl)
      ws.value = socket
      setupWebSocket(socket, subscription, opts)
    }
    catch (err) {
      console.error('[useFlowWebSocket] Error creating WebSocket:', err)
      opts?.onError?.(err)
      attemptReconnect()
    }
  }

  const subscribe = (subscription: FlowSubscription, opts?: UseFlowWebSocketOptions) => {
    innerSubscribe(subscription, opts)
  }

  const unsubscribe = () => {
    if (currentSubscription && ws.value && ws.value.readyState === WebSocket.OPEN) {
      send({
        type: 'unsubscribe',
        flowName: currentSubscription.flowName,
        runId: currentSubscription.runId,
      })
    }
    currentSubscription = null
  }

  onBeforeUnmount(() => stop())

  return {
    subscribe,
    unsubscribe,
    stop,
    connected,
    reconnecting,
  }
}

export default useFlowWebSocket
