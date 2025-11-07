import { promises as fsp } from 'node:fs'
import { dirname, join } from 'node:path'
import type { EventStoreAdapter, EventReadOptions, EventSubscription } from '../types'
import type { EventRecord } from '../../../types'
import { useRuntimeConfig } from '#imports'

function nowIso() {
  return new Date().toISOString()
}

function sanitize(name: string) {
  return name.replace(/[^\w.-]/g, '_')
}

async function ensureDir(path: string) {
  try {
    await fsp.mkdir(path, { recursive: true })
  }
  catch { void 0 }
}

async function fileExists(path: string) {
  try {
    await fsp.access(path)
    return true
  }
  catch { return false }
}

export function createFileAdapter(): EventStoreAdapter {
  const rc: any = useRuntimeConfig()
  const rootDir = rc?.queue?.rootDir || process.cwd()
  const dirRoot = rc?.queue?.eventStore?.options?.file?.dir
    ? join(rootDir, rc.queue.eventStore.options.file.dir)
    : join(rootDir, '.data/nq-events')
  const ext = rc?.queue?.eventStore?.options?.file?.ext || '.ndjson'
  const pollMs = rc?.queue?.eventStore?.options?.file?.pollMs ?? 1000

  const subscribers = new Map<string, Set<(e: EventRecord) => void>>()
  const timers = new Map<string, NodeJS.Timeout>()
  const lastIds = new Map<string, string | undefined>()

  interface FileIndexEntry {
    id: string
    score: number
    status?: 'running' | 'completed' | 'failed'
    startedAt?: number
    completedAt?: number
    stepCount?: number
    completedSteps?: number
    emittedEvents?: string[]
  }

  const indices = new Map<string, FileIndexEntry[]>()

  const streamPath = (stream: string) => join(dirRoot, sanitize(stream) + ext)
  const indexPath = (key: string) => join(dirRoot, 'indices', sanitize(key) + '.json')

  const readAll = async (stream: string): Promise<EventRecord[]> => {
    const p = streamPath(stream)
    if (!(await fileExists(p))) return []
    const content = await fsp.readFile(p, 'utf8')
    const lines = content.split('\n').filter(Boolean)
    const out: EventRecord[] = []
    for (const line of lines) {
      try {
        const rec = JSON.parse(line) as EventRecord
        out.push(rec)
      }
      catch {
        // ignore malformed line
      }
    }
    return out
  }

  const adapter: EventStoreAdapter = {
    async append(stream: string, e: Omit<EventRecord, 'id' | 'ts'>): Promise<EventRecord> {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
      const rec: any = { ...(e as any), id, ts: nowIso() }
      const p = streamPath(stream)
      await ensureDir(dirname(p))
      await fsp.appendFile(p, JSON.stringify(rec) + '\n', { encoding: 'utf8' })
      // notify in-proc subscribers (best effort)
      const set = subscribers.get(stream)
      if (set) {
        for (const cb of set) {
          try {
            cb(rec)
          }
          catch { void 0 }
        }
      }
      return rec
    },
    async read(stream: string, opts?: EventReadOptions): Promise<EventRecord[]> {
      const list = await readAll(stream)
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
      if (!opts?.fromId) {
        if (opts?.limit && opts.limit > 0) return list.slice(0, opts.limit)
        return list
      }
      const idx = list.findIndex(e => e.id === opts.fromId)
      const sliced = idx >= 0 ? list.slice(idx + 1) : list
      if (opts?.limit && opts.limit > 0) return sliced.slice(0, opts.limit)
      return sliced
    },
    async subscribe(stream: string, onEvent: (e: EventRecord) => void): Promise<EventSubscription> {
      let set = subscribers.get(stream)
      if (!set) {
        set = new Set()
        subscribers.set(stream, set)
      }
      set.add(onEvent)
      // start polling if not already
      if (!timers.has(stream)) {
        const t = setInterval(async () => {
          try {
            const fromId = lastIds.get(stream)
            const fresh = await adapter.read(stream, fromId ? { fromId } : undefined)
            if (fresh.length) {
              for (const rec of fresh) {
                set!.forEach((cb) => {
                  try {
                    cb(rec)
                  }
                  catch { void 0 }
                })
                lastIds.set(stream, rec.id)
              }
            }
          }
          catch {
            // ignore periodically
          }
        }, pollMs)
        // @ts-ignore Node typings union
        timers.set(stream, t)
      }
      return {
        unsubscribe() {
          const s = subscribers.get(stream)
          if (s) s.delete(onEvent)
          if (s && s.size === 0) {
            subscribers.delete(stream)
            const t = timers.get(stream)
            if (t) {
              try {
                clearInterval(t)
              }
              catch { void 0 }
              timers.delete(stream)
            }
          }
        },
      }
    },
    async deleteStream(subject: string): Promise<void> {
      const p = streamPath(subject)
      try {
        await fsp.unlink(p)
      }
      catch {
        // ignore if doesn't exist
      }
      subscribers.delete(subject)
      const t = timers.get(subject)
      if (t) {
        clearInterval(t)
        timers.delete(subject)
      }
      lastIds.delete(subject)
    },
    async deleteByPattern(pattern: string): Promise<number> {
      // Convert glob pattern to regex
      const regexPattern = pattern
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.')
      const regex = new RegExp(`^${regexPattern}$`)

      let count = 0
      try {
        await ensureDir(dirRoot)
        const files = await fsp.readdir(dirRoot)

        for (const file of files) {
          if (!file.endsWith(ext)) continue

          // Remove extension and unsanitize (approximately)
          const subject = file.slice(0, -ext.length)

          if (regex.test(subject)) {
            const p = join(dirRoot, file)
            await fsp.unlink(p)
            subscribers.delete(subject)
            const t = timers.get(subject)
            if (t) {
              clearInterval(t)
              timers.delete(subject)
            }
            lastIds.delete(subject)
            count++
          }
        }
      }
      catch {
        // ignore errors
      }

      return count
    },
    async deleteIndex(key: string): Promise<void> {
      // Remove from memory
      indices.delete(key)

      // Remove from file system
      const p = indexPath(key)
      try {
        await fsp.unlink(p)
      }
      catch {
        // ignore if doesn't exist
      }
    },
    async indexAdd(key: string, id: string, score: number, metadata?: Record<string, any>): Promise<void> {
      // Load existing index from memory cache
      let data = indices.get(key)

      // If not in memory, try to load from file
      if (!data) {
        const p = indexPath(key)
        if (await fileExists(p)) {
          try {
            const content = await fsp.readFile(p, 'utf8')
            data = JSON.parse(content) as FileIndexEntry[]
          }
          catch {
            data = []
          }
        }
        else {
          data = []
        }
        indices.set(key, data)
      }

      // Update or add entry
      const existing = data.findIndex(entry => entry.id === id)
      if (existing >= 0) {
        data[existing] = { ...data[existing], score, ...metadata }
      }
      else {
        data.push({ id, score, ...metadata })
      }

      // Persist to file
      const p = indexPath(key)
      await ensureDir(dirname(p))
      await fsp.writeFile(p, JSON.stringify(data, null, 2), 'utf8')
    },
    async indexRead(key: string, opts?: { offset?: number, limit?: number }) {
      // Load from memory cache first
      let data = indices.get(key)

      // If not in memory, try to load from file
      if (!data) {
        const p = indexPath(key)
        if (await fileExists(p)) {
          try {
            const content = await fsp.readFile(p, 'utf8')
            data = JSON.parse(content) as FileIndexEntry[]
            indices.set(key, data)
          }
          catch {
            data = []
          }
        }
        else {
          data = []
        }
      }

      // Sort by score descending (newest first)
      const sorted = [...data].sort((a, b) => b.score - a.score)

      const offset = opts?.offset || 0
      const limit = opts?.limit || 50

      return sorted.slice(offset, offset + limit).map(entry => ({
        id: entry.id,
        score: entry.score,
        metadata: {
          status: entry.status,
          startedAt: entry.startedAt,
          completedAt: entry.completedAt,
          stepCount: entry.stepCount,
          completedSteps: entry.completedSteps,
          emittedEvents: entry.emittedEvents,
        },
      }))
    },
    async indexGet(key: string, id: string) {
      // Load from memory cache first
      let data = indices.get(key)

      // If not in memory, try to load from file
      if (!data) {
        const p = indexPath(key)
        if (await fileExists(p)) {
          try {
            const content = await fsp.readFile(p, 'utf8')
            data = JSON.parse(content) as FileIndexEntry[]
            indices.set(key, data)
          }
          catch {
            data = []
          }
        }
        else {
          data = []
        }
      }

      const entry = data.find(e => e.id === id)
      if (!entry) return null

      return {
        id: entry.id,
        score: entry.score,
        metadata: {
          status: entry.status,
          startedAt: entry.startedAt,
          completedAt: entry.completedAt,
          stepCount: entry.stepCount,
          completedSteps: entry.completedSteps,
          emittedEvents: entry.emittedEvents,
        },
      }
    },
    async indexUpdate(key: string, id: string, metadata: Record<string, any>): Promise<boolean> {
      // Load existing index from memory cache
      let data = indices.get(key)

      // If not in memory, try to load from file
      if (!data) {
        const p = indexPath(key)
        if (await fileExists(p)) {
          try {
            const content = await fsp.readFile(p, 'utf8')
            data = JSON.parse(content) as FileIndexEntry[]
          }
          catch {
            data = []
          }
        }
        else {
          data = []
        }
        indices.set(key, data)
      }

      // Find and update entry
      const entry = data.find(e => e.id === id)
      if (!entry) return false

      // Simple merge - no version check needed (single instance)
      Object.assign(entry, metadata)

      // Persist to file
      const p = indexPath(key)
      await ensureDir(dirname(p))
      await fsp.writeFile(p, JSON.stringify(data, null, 2), 'utf8')

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

        // Retry with exponential backoff
        await new Promise(resolve => setTimeout(resolve, 10 * Math.pow(2, attempt)))
      }

      throw new Error(`Failed to update index after ${maxRetries} retries`)
    },
    async indexIncrement(key: string, id: string, field: string, increment = 1): Promise<number> {
      // Load existing index from memory cache
      let data = indices.get(key)

      // If not in memory, try to load from file
      if (!data) {
        const p = indexPath(key)
        if (await fileExists(p)) {
          try {
            const content = await fsp.readFile(p, 'utf8')
            data = JSON.parse(content) as FileIndexEntry[]
          }
          catch {
            data = []
          }
        }
        else {
          data = []
        }
        indices.set(key, data)
      }

      // Find entry
      const entry = data.find(e => e.id === id)
      if (!entry) return 0

      // Increment the field
      const currentValue = (entry as any)[field] || 0
      const newValue = currentValue + increment
      ;(entry as any)[field] = newValue

      // Persist to file
      const p = indexPath(key)
      await ensureDir(dirname(p))
      await fsp.writeFile(p, JSON.stringify(data, null, 2), 'utf8')

      return newValue
    },
    async cleanupCompletedFlows(key: string, retentionSeconds: number): Promise<number> {
      // Load existing index from memory cache
      let data = indices.get(key)

      // If not in memory, try to load from file
      if (!data) {
        const p = indexPath(key)
        if (await fileExists(p)) {
          try {
            const content = await fsp.readFile(p, 'utf8')
            data = JSON.parse(content) as FileIndexEntry[]
          }
          catch {
            data = []
          }
        }
        else {
          data = []
        }
        indices.set(key, data)
      }

      const now = Date.now()
      const cutoffTime = now - (retentionSeconds * 1000)

      // Filter out completed/failed flows older than retention period
      const originalLength = data.length
      const filtered = data.filter((entry) => {
        const isTerminal = entry.status === 'completed' || entry.status === 'failed'
        const isOld = entry.completedAt ? entry.completedAt < cutoffTime : false
        return !(isTerminal && isOld)
      })

      const removedCount = originalLength - filtered.length

      if (removedCount > 0) {
        indices.set(key, filtered)

        // Persist to file
        const p = indexPath(key)
        await ensureDir(dirname(p))
        await fsp.writeFile(p, JSON.stringify(filtered, null, 2), 'utf8')
      }

      return removedCount
    },
    async setMetadataTTL(_key: string, _id: string, _ttlSeconds: number): Promise<void> {
      // File adapter doesn't use TTL - cleanup is handled by cleanupCompletedFlows
      // This is a no-op for file storage
    },
    async close(): Promise<void> {
      for (const t of timers.values()) {
        try {
          clearInterval(t)
        }
        catch { void 0 }
      }
      timers.clear()
      subscribers.clear()
      lastIds.clear()
    },
  }

  return adapter
}
