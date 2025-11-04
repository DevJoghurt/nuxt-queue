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
  const dirRoot = rc?.queue?.eventStore?.options?.file?.dir || join(process.cwd(), '.nq-events')
  const ext = rc?.queue?.eventStore?.options?.file?.ext || '.ndjson'
  const pollMs = rc?.queue?.eventStore?.options?.file?.pollMs ?? 1000

  const subscribers = new Map<string, Set<(e: EventRecord) => void>>()
  const timers = new Map<string, NodeJS.Timeout>()
  const lastIds = new Map<string, string | undefined>()

  const streamPath = (stream: string) => join(dirRoot, sanitize(stream) + ext)

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
    async deleteIndex(_key: string): Promise<void> {
      // File adapter doesn't support indices
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
