import type { EventStoreProvider } from './contracts'

export function createMemoryEventStore(): EventStoreProvider {
  const events = new Map<string, any[]>()
  const listeners = new Map<string, Set<(e: any) => void>>()
  return {
    async append(stream, e) {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
      const rec = { ...e, id, ts: new Date().toISOString(), stream }
      const list = events.get(stream) || []
      list.push(rec)
      events.set(stream, list)
      const set = listeners.get(stream)
      if (set) set.forEach(cb => cb(rec))
      return rec
    },
    async read(stream, opts) {
      const list = events.get(stream) || []
      if (!opts?.fromId) return list
      const idx = list.findIndex((e: any) => e.id === opts.fromId)
      return idx >= 0 ? list.slice(idx + 1) : list
    },
    async subscribe(stream, onEvent) {
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
    async close() {
      listeners.clear()
      events.clear()
    },
  }
}
