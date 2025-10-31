import { useStorage } from '#imports'
import type { StreamAdapter, EventReadOptions, EventSubscription } from '../types'
import type { EventRecord } from '../../../types'

const listeners = new Map<string, Set<(e: EventRecord) => void>>()

function nowIso() {
  return new Date().toISOString()
}

export function createRedisFallbackStreamAdapter(): StreamAdapter {
  const storage = useStorage('redis')

  return {
    async append(stream: string, e: Omit<EventRecord, 'id' | 'ts'>): Promise<EventRecord> {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
      const rec: any = { ...(e as any), id, ts: nowIso() }
      const key = `events:${stream}`
      const curr = (await storage.getItem<any[]>(key)) || []
      curr.push(rec)
      await storage.setItem(key, curr)
      const set = listeners.get(stream)
      if (set) set.forEach(cb => cb(rec))
      return rec
    },
    async read(stream: string, opts?: EventReadOptions): Promise<EventRecord[]> {
      const key = `events:${stream}`
      const curr = (await storage.getItem<EventRecord[]>(key)) || []
      const dir = opts?.direction || 'forward'
      if (dir === 'backward') {
        let end = curr.length
        if (opts?.fromId) {
          const idx = curr.findIndex(e => e.id === opts.fromId)
          end = idx >= 0 ? idx : curr.length
        }
        const count = opts?.limit && opts.limit > 0 ? opts.limit : end
        const start = Math.max(0, end - count)
        const slice = curr.slice(start, end)
        return slice.reverse()
      }
      if (!opts?.fromId) {
        if (opts?.limit && opts.limit > 0) return curr.slice(0, opts.limit)
        return curr
      }
      const idx = curr.findIndex(e => e.id === opts.fromId)
      const out = idx >= 0 ? curr.slice(idx + 1) : curr
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
    async indexAdd(key: string, id: string, score: number): Promise<void> {
      const indexKey = `index:${key}`
      const data = (await storage.getItem<Array<{ id: string, score: number }>>(indexKey)) || []

      // Update or add entry
      const existing = data.findIndex(entry => entry.id === id)
      if (existing >= 0) {
        data[existing].score = score
      }
      else {
        data.push({ id, score })
      }

      await storage.setItem(indexKey, data)
    },
    async indexRead(key: string, opts?: { offset?: number, limit?: number }) {
      const indexKey = `index:${key}`
      const data = (await storage.getItem<Array<{ id: string, score: number }>>(indexKey)) || []

      // Sort by score descending (newest first)
      const sorted = [...data].sort((a, b) => b.score - a.score)

      const offset = opts?.offset || 0
      const limit = opts?.limit || 50

      return sorted.slice(offset, offset + limit)
    },
    async close(): Promise<void> {
      listeners.clear()
    },
  }
}
