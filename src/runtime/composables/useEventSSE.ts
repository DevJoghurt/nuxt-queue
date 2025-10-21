import { ref, onBeforeUnmount } from '#imports'

export interface UseEventSSEOptions {
  withCredentials?: boolean
  autoReconnect?: boolean
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  // Build URL on reconnect with last id (e.g. append fromId)
  buildUrl?: (baseUrl: string, lastId?: string) => string
  // Extract id from message for resume
  extractId?: (msg: any) => string | undefined
  onOpen?: () => void
  onError?: (err?: any) => void
}

export function useEventSSE() {
  const source = ref<EventSource | null>(null)
  const open = ref(false)
  const reconnecting = ref(false)
  const lastId = ref<string | undefined>(undefined)
  let retry = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let currentUrl = ''
  // cached for potential future enhancements
  // let currentOnMessage: ((data: any) => void) | null = null
  // let currentOpts: UseEventSSEOptions | undefined

  const computeDelay = (opts?: UseEventSSEOptions) => {
    const base = Math.max(100, opts?.baseDelayMs ?? 500)
    const max = Math.max(base, opts?.maxDelayMs ?? 10_000)
    // Exponential backoff with jitter
    const exp = Math.min(max, base * Math.pow(2, retry))
    const jitter = Math.floor(Math.random() * Math.min(1000, exp / 4))
    return exp + jitter
  }

  const clearTimer = () => {
    if (reconnectTimer) {
      try {
        clearTimeout(reconnectTimer)
      }
      catch {
        // ignore
      }
      reconnectTimer = null
    }
  }

  const stop = () => {
    clearTimer()
    try {
      source.value?.close()
    }
    catch {
      // ignore
    }
    source.value = null
    open.value = false
    reconnecting.value = false
    retry = 0
  }

  const attach = (es: EventSource, onMessage: (data: any) => void, opts?: UseEventSSEOptions) => {
    es.onopen = () => {
      open.value = true
      reconnecting.value = false
      retry = 0
      opts?.onOpen?.()
    }
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data)
        const id = opts?.extractId?.(data)
          ?? (typeof data?.record?.id === 'string' ? data.record.id : undefined)
        if (id) lastId.value = id
        onMessage?.(data)
      }
      catch {
        // ignore malformed frames
      }
    }
    es.onerror = (err) => {
      opts?.onError?.(err)
      if (!opts?.autoReconnect) {
        stop()
        return
      }
      const max = Math.max(0, opts?.maxRetries ?? 10)
      if (retry >= max) {
        stop()
        return
      }
      retry++
      reconnecting.value = true
      const delay = computeDelay(opts)
      clearTimer()
      reconnectTimer = setTimeout(() => {
        const url = (opts?.buildUrl || defaultBuildUrl)(currentUrl, lastId.value)
        innerStart(url, onMessage, opts)
      }, delay)
    }
  }

  const defaultBuildUrl = (baseUrl: string, last?: string) => {
    if (!last) return baseUrl
    const u = new URL(baseUrl, typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
    if (!u.searchParams.has('fromId')) u.searchParams.append('fromId', last)
    return u.toString()
  }

  const innerStart = (url: string, onMessage: (data: any) => void, opts?: UseEventSSEOptions) => {
    if (source.value) stop()
    currentUrl = url
    // currentOnMessage = onMessage
    // currentOpts = opts
    const es = new EventSource(url, { withCredentials: !!opts?.withCredentials })
    source.value = es
    attach(es, onMessage, opts)
  }

  const start = (url: string, onMessage: (data: any) => void, opts?: UseEventSSEOptions) => {
    innerStart(url, onMessage, opts)
  }

  onBeforeUnmount(() => stop())

  return { start, stop, open, reconnecting, lastId }
}

export default useEventSSE
