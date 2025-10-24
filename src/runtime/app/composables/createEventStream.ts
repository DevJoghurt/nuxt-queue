export interface EventStreamMessage<T = any> {
  v: number
  stream: string
  event: string
  record: {
    id: string
    ts: string
    kind: string
    subject?: string
    data: T
    meta?: any
    correlationId?: string
    causationId?: string
    v?: number
    stream: string
  }
}

export function createEventStream(endpoint = '/api/_events/ws') {
  let ws: WebSocket | null = null
  const listeners = new Set<(msg: EventStreamMessage) => void>()

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return ws
    ws = new WebSocket((typeof location !== 'undefined' ? (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host : '') + endpoint)
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as EventStreamMessage
        listeners.forEach(l => l(msg))
      }
      catch {
        // ignore malformed
      }
    }
    return ws
  }

  function onMessage(cb: (msg: EventStreamMessage) => void) {
    listeners.add(cb)
    return () => listeners.delete(cb)
  }

  function subscribe(stream: string) {
    connect()
    ws!.send(JSON.stringify({ type: 'subscribe', stream }))
    return () => ws?.send(JSON.stringify({ type: 'unsubscribe', stream }))
  }

  return { connect, onMessage, subscribe }
}
