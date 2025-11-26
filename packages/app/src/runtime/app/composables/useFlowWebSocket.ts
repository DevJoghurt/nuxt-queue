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

export interface StatsSubscription {
  onInitial?: (data: any) => void
  onUpdate?: (data: any) => void
}

// Singleton state - shared across all instances
let sharedWs: WebSocket | null = null
let sharedConnected = false
let sharedReconnecting = false
let retry = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let currentOptions: UseFlowWebSocketOptions | undefined
let currentSubscription: FlowSubscription | null = null
let currentStatsSubscription: StatsSubscription | null = null
let pendingStatsSubscription = false // Track if stats subscription is pending connection
let isStatsSubscribed = false // Track if stats are actually subscribed on server
let statsCache: any[] = [] // Cache last received stats for replay
let pingInterval: ReturnType<typeof setInterval> | null = null
let isServerRestarting = false
let refCount = 0 // Track how many components are using the connection

/**
 * WebSocket composable for flow run events and flow stats
 * Architecture: Client (this) → WebSocket → Server Handler → StreamAdapter.subscribe(StreamTopics.flowEvents)
 * Supports subscribing to specific flow runs and global flow statistics
 * Uses a singleton connection shared across all instances
 */
export function useFlowWebSocket() {
  const ws = ref<WebSocket | null>(sharedWs)
  const connected = ref(sharedConnected)
  const reconnecting = ref(sharedReconnecting)

  refCount++

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
        console.error('[useFlowWebSocket] Error sending message:', err)
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
    // Component unmounting
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
      console.warn('[useFlowWebSocket] Error closing WebSocket:', err)
    }
    sharedWs = null
    sharedConnected = false
    sharedReconnecting = false
    updateRefs()
    retry = 0
    refCount = 0
    currentSubscription = null
    currentStatsSubscription = null
    isStatsSubscribed = false
    pendingStatsSubscription = false
    statsCache = []
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
    sharedReconnecting = true
    updateRefs()

    // If server is restarting, wait longer before reconnecting
    // This gives Nitro time to fully shut down and restart
    const baseDelay = isServerRestarting ? 2000 : computeDelay(currentOptions)
    const delay = baseDelay

    // Will attempt reconnection

    clearTimers()
    reconnectTimer = setTimeout(() => {
      // Reconnect with both subscriptions if they existed
      if (currentSubscription || currentStatsSubscription) {
        connect(currentOptions)
      }
    }, delay)
  }

  const setupWebSocket = (socket: WebSocket, opts?: UseFlowWebSocketOptions) => {
    socket.onopen = () => {
      console.log('[useFlowWebSocket] Connected')
      sharedConnected = true
      sharedReconnecting = false
      updateRefs()
      retry = 0

      // Start ping interval
      startPingInterval()

      // Resubscribe to flow run if needed
      if (currentSubscription) {
        send({
          type: 'subscribe',
          flowName: currentSubscription.flowName,
          runId: currentSubscription.runId,
        })
      }

      // Resubscribe to stats if needed
      if (currentStatsSubscription || pendingStatsSubscription) {
        // Sending stats subscription after connection opened
        send({
          type: 'subscribe.stats',
        })
        pendingStatsSubscription = false
      }

      opts?.onOpen?.()
    }

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)

        switch (data.type) {
          case 'connected':
            break

          case 'subscribed':
            break

          case 'unsubscribed':
            break

          case 'stats.subscribed':
            isStatsSubscribed = true
            break

          case 'stats.unsubscribed':
            isStatsSubscribed = false
            break

          case 'flow.stats.initial': {
            // Store in cache
            const existingIndex = statsCache.findIndex(s => s.id === data.data.id)
            if (existingIndex >= 0) {
              statsCache[existingIndex] = data.data
            }
            else {
              statsCache.push(data.data)
            }
            // Trigger handler
            if (currentStatsSubscription?.onInitial) {
              currentStatsSubscription.onInitial(data.data)
            }
            else {
              console.warn('[useFlowWebSocket] No onInitial handler for stats:', data.data)
            }
            break
          }

          case 'flow.stats.update': {
            // Update cache
            const cacheIndex = statsCache.findIndex(s => s.id === data.data.id)
            if (cacheIndex >= 0) {
              statsCache[cacheIndex] = data.data
            }
            else {
              statsCache.push(data.data)
            }
            // Trigger handler
            if (currentStatsSubscription?.onUpdate) {
              currentStatsSubscription.onUpdate(data.data)
            }
            else {
              console.warn('[useFlowWebSocket] No onUpdate handler for stats:', data.data)
            }
            break
          }

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
            // Server is restarting (HMR)
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
      sharedConnected = false
      updateRefs()
      clearTimers()
      opts?.onClose?.(event)

      // Attempt reconnection for abnormal closures or server restarts
      // 1000 = normal closure (user initiated)
      // 1001 = going away (server restart/HMR) - should reconnect
      // 1006 = abnormal closure - should reconnect
      const shouldReconnect = event.code !== 1000 && opts?.autoReconnect
      if (shouldReconnect) {
        // Will attempt reconnection
        attemptReconnect()
      }
      else {
        // Reset server restart flag on normal closure
        isServerRestarting = false
      }
    }
  }

  const connect = (opts?: UseFlowWebSocketOptions) => {
    // WebSocket is only available in the browser
    if (import.meta.server || typeof WebSocket === 'undefined') {
      console.warn('[useFlowWebSocket] WebSocket not available (SSR context)')
      return
    }

    // If already connected or connecting, no need to reconnect
    if (sharedWs && (sharedWs.readyState === WebSocket.OPEN || sharedWs.readyState === WebSocket.CONNECTING)) {
      // Reusing existing connection
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
      const wsUrl = `${protocol}//${window.location.host}/api/_flows/ws`

      const socket = new WebSocket(wsUrl)
      sharedWs = socket
      updateRefs()
      setupWebSocket(socket, opts)
    }
    catch (err) {
      console.error('[useFlowWebSocket] Error creating WebSocket:', err)
      opts?.onError?.(err)
      attemptReconnect()
    }
  }

  const subscribe = (subscription: FlowSubscription, opts?: UseFlowWebSocketOptions) => {
    // Unsubscribe from previous flow if exists
    if (currentSubscription && sharedWs && sharedWs.readyState === WebSocket.OPEN) {
      send({
        type: 'unsubscribe',
        flowName: currentSubscription.flowName,
        runId: currentSubscription.runId,
      })
    }

    // Update subscription
    // Server will subscribe to StreamTopics.flowEvents(runId) and send updates
    // Historical events loaded from StoreSubjects.flowRun(runId)
    currentSubscription = subscription

    // If we already have an open connection, just subscribe
    if (sharedWs && sharedWs.readyState === WebSocket.OPEN) {
      // Reusing connection, subscribing to flow run
      send({
        type: 'subscribe',
        flowName: subscription.flowName,
        runId: subscription.runId,
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
        flowName: currentSubscription.flowName,
        runId: currentSubscription.runId,
      })
    }
    currentSubscription = null
  }

  const subscribeStats = (subscription: StatsSubscription, opts?: UseFlowWebSocketOptions) => {
    // Store stats subscription
    // Server will subscribe to StreamTopics.flowStats() and send updates
    currentStatsSubscription = subscription

    // If we already have an open connection with active subscription, just update handlers
    if (sharedWs && sharedWs.readyState === WebSocket.OPEN) {
      if (isStatsSubscribed) {
        // Reusing connection and existing stats subscription, replaying cached stats
        // Replay cached stats to new handlers
        if (subscription.onInitial && statsCache.length > 0) {
          for (const cachedStat of statsCache) {
            subscription.onInitial(cachedStat)
          }
        }
        return
      }
      // Not subscribed yet, send subscription
      // Reusing connection, subscribing to stats
      send({
        type: 'subscribe.stats',
      })
      return
    }

    // If connection is in progress, wait for it to open
    if (sharedWs && sharedWs.readyState === WebSocket.CONNECTING) {
      // Connection is opening, marking stats subscription as pending
      pendingStatsSubscription = true
      return
    }

    // Connection is pending or not established, mark subscription as pending
    // No connection, marking stats subscription as pending
    pendingStatsSubscription = true

    // No active connection, connect first
    // The subscription will be sent when onopen fires
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
    forceClose, // Exposed for debugging/manual cleanup
    connected,
    reconnecting,
  }
}

export default useFlowWebSocket
