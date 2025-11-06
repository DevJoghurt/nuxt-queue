import type { EventStoreAdapter, EventReadOptions, EventSubscription } from '../types'
import type { EventRecord } from '../../../types'

// Store data in globalThis to survive HMR reloads
interface MemoryAdapterStore {
  events: Map<string, EventRecord[]>
  listeners: Map<string, Set<(e: EventRecord) => void>>
  indices: Map<string, Array<{ id: string, score: number, metadata?: any }>>
}

const GLOBAL_KEY = '__nuxt_queue_memory_adapter__'

function getStore(): MemoryAdapterStore {
  if (!(globalThis as any)[GLOBAL_KEY]) {
    (globalThis as any)[GLOBAL_KEY] = {
      events: new Map<string, EventRecord[]>(),
      listeners: new Map<string, Set<(e: EventRecord) => void>>(),
      indices: new Map<string, Array<{ id: string, score: number, metadata?: any }>>(),
    }
  }
  return (globalThis as any)[GLOBAL_KEY]
}

export function createMemoryAdapter(): EventStoreAdapter {
  const { events, listeners, indices } = getStore()

  return {
    async append(stream: string, e: Omit<EventRecord, 'id' | 'ts'>): Promise<EventRecord> {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
      const rec: any = { ...(e as any), id, ts: new Date().toISOString() }
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
    async indexAdd(key: string, id: string, score: number, metadata?: Record<string, any>): Promise<void> {
      const data = indices.get(key) || []

      // Update or add entry with metadata
      const existing = data.findIndex(entry => entry.id === id)
      if (existing >= 0) {
        data[existing].score = score
        if (metadata) {
          data[existing].metadata = metadata
        }
      }
      else {
        data.push({ id, score, metadata })
      }

      indices.set(key, data)
    },
    async indexRead(key: string, opts?: { offset?: number, limit?: number }) {
      const data = indices.get(key) || []

      // Sort by score descending (newest first)
      const sorted = [...data].sort((a, b) => b.score - a.score)

      const offset = opts?.offset || 0
      const limit = opts?.limit || 50

      return sorted.slice(offset, offset + limit)
    },
    async indexGet(key: string, id: string) {
      const data = indices.get(key) || []
      const entry = data.find(item => item.id === id)

      if (!entry) return null

      return {
        id: entry.id,
        score: entry.score,
        metadata: entry.metadata,
      }
    },
    async indexUpdate(key: string, id: string, metadata: Record<string, any>): Promise<boolean> {
      const data = indices.get(key) || []
      const entryIndex = data.findIndex(item => item.id === id)

      if (entryIndex === -1) {
        // Entry doesn't exist, create it
        data.push({ id, score: Date.now(), metadata: { ...metadata, version: 1 } })
        indices.set(key, data)
        return true
      }

      const entry = data[entryIndex]
      const currentVersion = entry.metadata?.version || 0
      const expectedVersion = metadata.version !== undefined ? metadata.version - 1 : currentVersion

      // Optimistic lock check
      if (currentVersion !== expectedVersion) {
        return false
      }

      // Update metadata
      entry.metadata = {
        ...entry.metadata,
        ...metadata,
        version: currentVersion + 1,
      }

      indices.set(key, data)
      return true
    },
    async indexUpdateWithRetry(
      key: string,
      id: string,
      metadata: Record<string, any>,
      maxRetries = 3,
    ): Promise<void> {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const success = await this.indexUpdate!(key, id, metadata)

        if (success) return

        // Version conflict - exponential backoff
        await new Promise(resolve => setTimeout(resolve, 10 * Math.pow(2, attempt)))
      }

      throw new Error(`Failed to update index after ${maxRetries} retries`)
    },
    async indexIncrement(key: string, id: string, field: string, increment = 1): Promise<number> {
      const data = indices.get(key) || []
      const entryIndex = data.findIndex(item => item.id === id)

      if (entryIndex === -1) {
        // Entry doesn't exist, create it with the increment value
        const newEntry = {
          id,
          score: Date.now(),
          metadata: { [field]: increment, version: 1 },
        }
        data.push(newEntry)
        indices.set(key, data)
        return increment
      }

      const entry = data[entryIndex]
      if (!entry.metadata) {
        entry.metadata = { version: 0 }
      }

      const currentValue = entry.metadata[field] || 0
      const newValue = currentValue + increment

      entry.metadata[field] = newValue
      entry.metadata.version = (entry.metadata.version || 0) + 1

      indices.set(key, data)
      return newValue
    },
    async deleteStream(subject: string): Promise<void> {
      events.delete(subject)
      listeners.delete(subject)
    },
    async deleteByPattern(pattern: string): Promise<number> {
      // Convert glob pattern to regex (simple implementation)
      const regexPattern = pattern
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.')
      const regex = new RegExp(`^${regexPattern}$`)

      let count = 0
      for (const key of events.keys()) {
        if (regex.test(key)) {
          events.delete(key)
          listeners.delete(key)
          count++
        }
      }

      return count
    },
    async deleteIndex(key: string): Promise<void> {
      indices.delete(key)
    },
    async close(): Promise<void> {
      listeners.clear()
      events.clear()
      indices.clear()
    },
  }
}
