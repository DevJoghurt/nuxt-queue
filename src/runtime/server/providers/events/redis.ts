import { useStorage } from '#imports'
import type { EventRecord, EventReadOptions, EventStoreProvider, EventSubscription } from './contracts'

const listeners = new Map<string, Set<(e: EventRecord) => void>>()

function nowIso() {
  return new Date().toISOString()
}

export function createRedisEventStore(): EventStoreProvider {
  const storage = useStorage('redis')

  return {
    async append<T = any>(stream: string, e: Omit<EventRecord<T>, 'id' | 'ts' | 'stream'>): Promise<EventRecord<T>> {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
      const rec: EventRecord<T> = { ...e, id, ts: nowIso(), stream }
      // Fallback append: push to a list under redis storage
      const key = `events:${stream}`
      const curr = (await storage.getItem<EventRecord<T>[]>(key)) || []
      curr.push(rec)
      await storage.setItem(key, curr)
      // Notify in-process listeners
      const set = listeners.get(stream)
      if (set) set.forEach(cb => cb(rec))
      return rec
    },
    async read(stream: string, opts?: EventReadOptions): Promise<EventRecord[]> {
      const key = `events:${stream}`
      const curr = (await storage.getItem<EventRecord[]>(key)) || []
      if (!opts?.fromId) return curr
      const idx = curr.findIndex(e => e.id === opts.fromId)
      return idx >= 0 ? curr.slice(idx + 1) : curr
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
    async close() {
      listeners.clear()
    },
  }
}
