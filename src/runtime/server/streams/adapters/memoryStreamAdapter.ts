import type { StreamAdapter, EventRecord, EventReadOptions, EventSubscription } from '../types'

export function createMemoryStreamAdapter(): StreamAdapter {
  const events = new Map<string, EventRecord[]>()
  const listeners = new Map<string, Set<(e: EventRecord) => void>>()
  return {
    async append<T = any>(stream: string, e: Omit<EventRecord<T>, 'id' | 'ts' | 'stream'>): Promise<EventRecord<T>> {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
      const rec: EventRecord<T> = { ...(e as any), id, ts: new Date().toISOString(), stream }
      const list = events.get(stream) || []
      list.push(rec)
      events.set(stream, list)
      const set = listeners.get(stream)
      if (set) set.forEach(cb => cb(rec))
      return rec
    },
    async read(stream: string, opts?: EventReadOptions): Promise<EventRecord[]> {
      const list = events.get(stream) || []
      const dir = opts?.direction || 'forward'
      if (dir === 'backward') {
        let end = list.length
        if (opts?.fromId) {
          const idx = list.findIndex(e => e.id === opts.fromId)
          end = idx >= 0 ? idx : list.length
        }
        const count = opts?.limit && opts.limit > 0 ? opts.limit : end
        const start = Math.max(0, end - count)
        const slice = list.slice(start, end)
        return slice.reverse()
      }
      // forward
      if (!opts?.fromId) {
        if (opts?.limit && opts.limit > 0) return list.slice(0, opts.limit)
        return list
      }
      const idx = list.findIndex((e: any) => e.id === opts.fromId)
      const out = idx >= 0 ? list.slice(idx + 1) : list
      if (opts?.limit && opts.limit > 0) return out.slice(0, opts.limit)
      return out
    },
    async subscribe(stream: string, onEvent: (e: EventRecord) => void): Promise<EventSubscription> {
      let set = listeners.get(stream)
      if (!set) {
        set = new Set()
        listeners.set(stream, set)
      }
      set.add(onEvent)
      return {
        unsubscribe() {
          set!.delete(onEvent)
        },
      }
    },
    async close(): Promise<void> {
      listeners.clear()
      events.clear()
    },
  }
}
