import { ref } from '#imports'
import type { QueueCounts } from './useQueues'

export interface QueueEvent {
  eventType: 'waiting' | 'active' | 'completed' | 'failed' | 'progress'
  jobId?: string
  [key: string]: any
}

// SINGLETON - One WebSocket shared across ALL component instances
let ws: WebSocket | null = null
const connected = ref(false)
const reconnecting = ref(false)
let retry = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
// Support multiple subscribers per queue
const subscriptions = new Map<string, Array<{
  id: string
  onCounts?: (counts: QueueCounts) => void
  onEvent?: (event: QueueEvent) => void
}>>()

const clearTimers = () => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

const send = (data: any) => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data))
  }
}

const stop = () => {
  clearTimers()
  if (ws) {
    try {
      ws.close(1000, 'Client closing')
    }
    catch (err) {
      console.warn('[useQueuesWebSocket] Error closing:', err)
    }
    ws = null
  }
  connected.value = false
  reconnecting.value = false
  retry = 0
  subscriptions.clear()
}

const attemptReconnect = () => {
  if (retry >= 10) {
    console.error('[useQueuesWebSocket] Max retries reached')
    stop()
    return
  }

  retry++
  reconnecting.value = true
  const delay = Math.min(1000 * Math.pow(2, retry), 10000)

  clearTimers()
  reconnectTimer = setTimeout(() => {
    connect()
  }, delay)
}

const connect = () => {
  if (import.meta.server || typeof WebSocket === 'undefined') return

  // Already open - just resubscribe
  if (ws && ws.readyState === WebSocket.OPEN) {
    for (const queueName of subscriptions.keys()) {
      send({ type: 'subscribe', queueName })
    }
    return
  }

  // Already connecting - wait for it
  if (ws && ws.readyState === WebSocket.CONNECTING) {
    console.log('[useQueuesWebSocket] Connection in progress, waiting...')
    return
  }

  // Close stale connection
  if (ws) {
    try {
      ws.close()
    }
    catch {
      // ignore
    }
    ws = null
  }

  try {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/api/_queues/ws`
    const socket = new WebSocket(wsUrl)
    ws = socket

    socket.onopen = () => {
      console.log('[useQueuesWebSocket] Connected')
      connected.value = true
      reconnecting.value = false
      retry = 0

      // Subscribe to all queues
      for (const queueName of subscriptions.keys()) {
        send({ type: 'subscribe', queueName })
      }
    }

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)

        if (data.type === 'counts' && data.queueName) {
          const subs = subscriptions.get(data.queueName)
          if (subs) {
            for (const sub of subs) {
              sub.onCounts?.(data.counts)
            }
          }
        }
        else if (data.type === 'event' && data.queueName) {
          const subs = subscriptions.get(data.queueName)
          if (subs) {
            for (const sub of subs) {
              sub.onEvent?.(data.event)
            }
          }
        }
      }
      catch (err) {
        console.error('[useQueuesWebSocket] Parse error:', err)
      }
    }

    socket.onerror = (err) => {
      console.error('[useQueuesWebSocket] Error:', err)
    }

    socket.onclose = (event) => {
      console.log('[useQueuesWebSocket] Closed:', event.code)
      connected.value = false
      ws = null

      if (event.code !== 1000 && subscriptions.size > 0) {
        attemptReconnect()
      }
    }
  }
  catch (err) {
    console.error('[useQueuesWebSocket] Connection error:', err)
    attemptReconnect()
  }
}

const subscribe = (
  queueName: string,
  onCounts?: (counts: QueueCounts) => void,
  onEvent?: (event: QueueEvent) => void,
) => {
  const id = `${queueName}_${Date.now()}_${Math.random()}`

  // Add to subscribers array for this queue
  const existing = subscriptions.get(queueName) || []
  existing.push({ id, onCounts, onEvent })
  subscriptions.set(queueName, existing)

  // Only send subscribe if this is the first subscriber for this queue
  const shouldSubscribe = existing.length === 1

  if (shouldSubscribe) {
    // If WebSocket is open, subscribe immediately
    if (ws && ws.readyState === WebSocket.OPEN) {
      send({ type: 'subscribe', queueName })
    }
    // If WebSocket is connecting, it will auto-subscribe when ready
    else if (ws && ws.readyState === WebSocket.CONNECTING) {
      // Do nothing, onopen will handle it
    }
    // Otherwise, start connection
    else {
      connect()
    }
  }

  return id
}

const unsubscribe = (queueName: string, id?: string) => {
  const existing = subscriptions.get(queueName)
  if (!existing) return

  if (id) {
    // Remove specific subscriber
    const filtered = existing.filter(sub => sub.id !== id)
    if (filtered.length > 0) {
      subscriptions.set(queueName, filtered)
    }
    else {
      // Last subscriber, unsubscribe from queue
      subscriptions.delete(queueName)
      send({ type: 'unsubscribe', queueName })
    }
  }
  else {
    // Remove all subscribers for this queue
    subscriptions.delete(queueName)
    send({ type: 'unsubscribe', queueName })
  }
}

/**
 * Shared WebSocket for queue updates
 * All instances share the same connection
 */
export function useQueuesWebSocket() {
  return {
    subscribe,
    unsubscribe,
    stop,
    connected,
    reconnecting,
  }
}
