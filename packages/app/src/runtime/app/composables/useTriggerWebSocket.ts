import { ref, onBeforeUnmount } from '#imports'

export interface UseTriggerWebSocketOptions {
  autoReconnect?: boolean
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  onOpen?: () => void
  onError?: (err?: any) => void
  onClose?: (event?: CloseEvent) => void
}

export interface TriggerSubscription {
  triggerName: string
  onEvent: (event: any) => void
  onHistory?: (events: any[]) => void
}

export interface TriggerStatsSubscription {
  onInitial?: (data: any) => void
  onUpdate?: (data: any) => void
}

// Singleton state - shared across all instances
let sharedWs: WebSocket | null = null
let sharedConnected = false
let sharedReconnecting = false
let retry = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let currentOptions: UseTriggerWebSocketOptions | undefined
let currentSubscription: TriggerSubscription | null = null
let currentStatsSubscription: TriggerStatsSubscription | null = null
let pingInterval: ReturnType<typeof setInterval> | null = null
let isServerRestarting = false
let refCount = 0 // Track how many components are using the connection

/**
 * WebSocket composable for trigger events and trigger stats
 * Supports subscribing to specific triggers and global trigger statistics
 * Uses a singleton connection shared across all instances
 */
export function useTriggerWebSocket() {
  const ws = ref<WebSocket | null>(sharedWs)
  const connected = ref(sharedConnected)
  const reconnecting = ref(sharedReconnecting)

  refCount++

  const computeDelay = (opts?: UseTriggerWebSocketOptions) => {
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

  const updateRefs = () => {
    ws.value = sharedWs
    connected.value = sharedConnected
    reconnecting.value = sharedReconnecting
  }

  const send = (data: any) => {
    if (sharedWs && sharedWs.readyState === WebSocket.OPEN) {
      try {
        sharedWs.send(JSON.stringify(data))
        return true
      }
      catch (err) {
        console.error('[useTriggerWebSocket] Error sending message:', err)
        return false
      }
    }
    return false
  }

  const startPingInterval = () => {
    clearTimers()
    // Send ping every 30 seconds to keep connection alive
    pingInterval = setInterval(() => {
      if (sharedWs && sharedWs.readyState === WebSocket.OPEN) {
        send({ type: 'ping' })
      }
    }, 30000)
  }

  const stop = () => {
    // Only decrement ref count, don't close connection
    refCount = Math.max(0, refCount - 1)
    console.log('[useTriggerWebSocket] Component unmounting, ref count:', refCount)
  }

  const forceClose = () => {
    clearTimers()
    isServerRestarting = false
    try {
      if (sharedWs) {
        sharedWs.close(1000, 'Client closing')
      }
    }
    catch (err) {
      console.warn('[useTriggerWebSocket] Error closing WebSocket:', err)
    }
    sharedWs = null
    sharedConnected = false
    sharedReconnecting = false
    updateRefs()
    retry = 0
    refCount = 0
    currentSubscription = null
    currentStatsSubscription = null
  }

  const attemptReconnect = () => {
    if (!currentOptions?.autoReconnect) {
      stop()
      return
    }

    const max = Math.max(0, currentOptions?.maxRetries ?? 10)
    if (retry >= max) {
      console.error('[useTriggerWebSocket] Max retries reached')
      stop()
      return
    }

    retry++
    reconnecting.value = true

    const baseDelay = isServerRestarting ? 2000 : computeDelay(currentOptions)
    const delay = baseDelay

    console.log(`[useTriggerWebSocket] Will attempt reconnection in ${delay}ms (attempt ${retry}/${max})${isServerRestarting ? ' [server restart]' : ''}`)

    clearTimers()
    reconnectTimer = setTimeout(() => {
      // Reconnect with both subscriptions if they existed
      if (currentSubscription || currentStatsSubscription) {
        connect(currentOptions)
      }
    }, delay)
  }

  const setupWebSocket = (socket: WebSocket, opts?: UseTriggerWebSocketOptions) => {
    socket.onopen = () => {
      console.log('[useTriggerWebSocket] Connected')
      sharedConnected = true
      sharedReconnecting = false
      updateRefs()
      retry = 0

      // Start ping interval
      startPingInterval()

      // Resubscribe to trigger if needed
      if (currentSubscription) {
        send({
          type: 'subscribe',
          triggerName: currentSubscription.triggerName,
        })
      }

      // Resubscribe to stats if needed
      if (currentStatsSubscription) {
        send({
          type: 'subscribe.stats',
        })
      }

      opts?.onOpen?.()
    }

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)

        switch (data.type) {
          case 'connected':
            console.log('[useTriggerWebSocket] Server acknowledged connection')
            break

          case 'subscribed':
            console.log('[useTriggerWebSocket] Subscribed to trigger:', data.triggerName)
            break

          case 'unsubscribed':
            console.log('[useTriggerWebSocket] Unsubscribed from trigger:', data.triggerName)
            break

          case 'stats.subscribed':
            console.log('[useTriggerWebSocket] Subscribed to trigger stats')
            break

          case 'stats.unsubscribed':
            console.log('[useTriggerWebSocket] Unsubscribed from trigger stats')
            break

          case 'trigger.stats.initial':
            if (currentStatsSubscription?.onInitial) {
              currentStatsSubscription.onInitial(data.data)
            }
            break

          case 'trigger.stats.update':
            if (currentStatsSubscription?.onUpdate) {
              currentStatsSubscription.onUpdate(data.data)
            }
            break

          case 'history':
            if (currentSubscription) {
              if (currentSubscription.onHistory) {
                currentSubscription.onHistory(data.events)
              }
              else {
                // If no onHistory handler, treat as individual events
                for (const eventData of data.events) {
                  currentSubscription.onEvent(eventData)
                }
              }
            }
            break

          case 'event':
            if (currentSubscription) {
              currentSubscription.onEvent(data.event)
            }
            break

          case 'pong':
            // Keep-alive response
            break

          case 'server-restart':
            console.log('[useTriggerWebSocket] Server is restarting (HMR)')
            isServerRestarting = true
            break

          case 'error':
            console.error('[useTriggerWebSocket] Server error:', data.message)
            opts?.onError?.(new Error(data.message))
            break

          default:
            console.warn('[useTriggerWebSocket] Unknown message type:', data.type)
        }
      }
      catch (err) {
        console.error('[useTriggerWebSocket] Error parsing message:', err)
      }
    }

    socket.onerror = (err) => {
      console.error('[useTriggerWebSocket] WebSocket error:', err)
      opts?.onError?.(err)
    }

    socket.onclose = (event) => {
      console.log('[useTriggerWebSocket] Connection closed:', event.code, event.reason)
      sharedConnected = false
      updateRefs()
      clearTimers()
      opts?.onClose?.(event)

      const shouldReconnect = event.code !== 1000 && opts?.autoReconnect
      if (shouldReconnect) {
        console.log('[useTriggerWebSocket] Will attempt reconnection (code:', event.code, ')')
        attemptReconnect()
      }
      else {
        isServerRestarting = false
      }
    }
  }

  const connect = (opts?: UseTriggerWebSocketOptions) => {
    // WebSocket is only available in the browser
    if (import.meta.server || typeof WebSocket === 'undefined') {
      console.warn('[useTriggerWebSocket] WebSocket not available (SSR context)')
      return
    }

    // If already connected, no need to reconnect
    if (sharedWs && sharedWs.readyState === WebSocket.OPEN) {
      console.log('[useTriggerWebSocket] Reusing existing connection')
      return
    }

    // Close any stale connection
    if (sharedWs) {
      try {
        sharedWs.close()
      }
      catch {
        // ignore
      }
    }

    currentOptions = opts

    try {
      // Construct WebSocket URL
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = `${protocol}//${window.location.host}/api/_triggers/ws`

      const socket = new WebSocket(wsUrl)
      sharedWs = socket
      updateRefs()
      setupWebSocket(socket, opts)
    }
    catch (err) {
      console.error('[useTriggerWebSocket] Error creating WebSocket:', err)
      opts?.onError?.(err)
      attemptReconnect()
    }
  }

  const subscribe = (subscription: TriggerSubscription, opts?: UseTriggerWebSocketOptions) => {
    // Unsubscribe from previous trigger if exists
    if (currentSubscription && sharedWs && sharedWs.readyState === WebSocket.OPEN) {
      send({
        type: 'unsubscribe',
        triggerName: currentSubscription.triggerName,
      })
    }

    // Update subscription
    currentSubscription = subscription

    // If we already have an open connection, just subscribe
    if (sharedWs && sharedWs.readyState === WebSocket.OPEN) {
      console.log('[useTriggerWebSocket] Reusing connection, subscribing to trigger')
      send({
        type: 'subscribe',
        triggerName: subscription.triggerName,
      })
      return
    }

    // No active connection, connect first
    connect(opts)
  }

  const unsubscribe = () => {
    if (currentSubscription && sharedWs && sharedWs.readyState === WebSocket.OPEN) {
      send({
        type: 'unsubscribe',
        triggerName: currentSubscription.triggerName,
      })
    }
    currentSubscription = null
  }

  const subscribeStats = (subscription: TriggerStatsSubscription, opts?: UseTriggerWebSocketOptions) => {
    // Store stats subscription
    currentStatsSubscription = subscription

    // If we already have an open connection, just subscribe to stats
    if (sharedWs && sharedWs.readyState === WebSocket.OPEN) {
      console.log('[useTriggerWebSocket] Reusing connection, subscribing to stats')
      send({
        type: 'subscribe.stats',
      })
      return
    }

    // No active connection, connect first
    connect(opts)
  }

  const unsubscribeStats = () => {
    if (currentStatsSubscription && sharedWs && sharedWs.readyState === WebSocket.OPEN) {
      send({
        type: 'unsubscribe.stats',
      })
    }
    currentStatsSubscription = null
  }

  onBeforeUnmount(() => {
    stop()
  })

  return {
    subscribe,
    unsubscribe,
    subscribeStats,
    unsubscribeStats,
    stop,
    forceClose,
    connected,
    reconnecting,
  }
}

export default useTriggerWebSocket
