import type { StreamAdapter, EventRecord, EventReadOptions, EventSubscription } from '../types'
import { useRuntimeConfig } from '#imports'
import IORedis from 'ioredis'

function nowIso() {
  return new Date().toISOString()
}

export function createRedisStreamsAdapter(): StreamAdapter {
  const rc: any = useRuntimeConfig()
  const conn = rc?.queue?.redis || {}
  const rsOpts = (rc?.queue?.eventStore?.options?.redisStreams || {}) as {
    group?: string
    consumer?: string
    blockMs?: number
    count?: number
    createGroupIfMissing?: boolean
    trim?: { maxLen?: number, approx?: boolean }
    minIdleMs?: number
    autoClaimIntervalMs?: number
    claimBatch?: number
  }
  const redis = new IORedis({
    host: conn.host,
    port: conn.port,
    username: conn.username,
    password: conn.password,
    lazyConnect: true,
  })

  let closed = false

  function buildFields(e: any) {
    // Store native stream fields for easy introspection without JSON-wrapping everything
    const dataStr = e.data !== undefined ? JSON.stringify(e.data) : ''
    const metaStr = e.meta !== undefined ? JSON.stringify(e.meta) : ''
    const fields: Array<string> = [
      'kind', String(e.kind || ''),
      'subject', e.subject != null ? String(e.subject) : '',
      'data', dataStr,
      'meta', metaStr,
      'corr', e.correlationId != null ? String(e.correlationId) : '',
      'cause', e.causationId != null ? String(e.causationId) : '',
      'ts', e.ts || nowIso(),
      'v', String(e.v ?? 1),
    ]
    return fields
  }

  function parseFieldsToRecord(id: string, arr: any[]): EventRecord {
    // arr is [field, value, field, value, ...]
    const obj: Record<string, string> = {}
    for (let i = 0; i < arr.length; i += 2) {
      const k = String(arr[i])
      const v = String(arr[i + 1] ?? '')
      obj[k] = v
    }
    let data: any
    let meta: any
    try {
      data = obj.data ? JSON.parse(obj.data) : undefined
    }
    catch {
      data = undefined
    }
    try {
      meta = obj.meta ? JSON.parse(obj.meta) : undefined
    }
    catch {
      meta = undefined
    }
    const rec: EventRecord = {
      id,
      stream: '', // will be set by caller if needed
      ts: obj.ts || nowIso(),
      kind: obj.kind || 'event',
      subject: obj.subject || undefined,
      data,
      meta,
      correlationId: obj.corr || undefined,
      causationId: obj.cause || undefined,
      v: obj.v ? Number(obj.v) : 1,
    }
    return rec
  }

  return {
    async append<T = any>(stream: string, e: Omit<EventRecord<T>, 'id' | 'ts' | 'stream'>): Promise<EventRecord<T>> {
      if (!redis.status || redis.status === 'end') await redis.connect()
      const payloadFields = buildFields({ ...e, stream })
      let id: string
      if (rsOpts?.trim?.maxLen && rsOpts.trim.maxLen > 0) {
        const approx = rsOpts?.trim?.approx !== false
        const args = approx ? ['MAXLEN', '~', String(rsOpts.trim.maxLen)] : ['MAXLEN', String(rsOpts.trim.maxLen)]
        id = await (redis as any).xadd(stream, ...args, '*', ...payloadFields)
      }
      else {
        id = await (redis as any).xadd(stream, '*', ...payloadFields)
      }
      const rec = { ...(e as any), id, ts: nowIso(), stream }
      return rec
    },
    async read(stream: string, opts?: EventReadOptions): Promise<EventRecord[]> {
      if (!redis.status || redis.status === 'end') await redis.connect()
      const from = opts?.fromId ? opts.fromId : '0-0'
      const count = opts?.limit || 100
      const dir = opts?.direction || 'forward'
      let resp: any[] = []
      if (dir === 'backward') {
        resp = await (redis as any).xrevrange(stream, from === '0-0' ? '+' : `(${from}`, '-', 'COUNT', count)
      }
      else {
        resp = await (redis as any).xrange(stream, from === '0-0' ? '-' : `(${from}`, '+', 'COUNT', count)
      }
      const out: EventRecord[] = []
      for (const [id, arr] of resp as any[]) {
        try {
          const rec = parseFieldsToRecord(id, arr)
          rec.stream = stream
          out.push(rec)
        }
        catch {
          // ignore
        }
      }
      return out
    },
    async subscribe(stream: string, onEvent: (e: EventRecord) => void): Promise<EventSubscription> {
      let running = true
      let lastId = '$'
      const ensure = async () => {
        if (!redis.status || redis.status === 'end') await redis.connect()
      }
      const blockMs = typeof rsOpts.blockMs === 'number' ? rsOpts.blockMs : 10000
      const count = typeof rsOpts.count === 'number' ? rsOpts.count : 100
      const minIdleMs = typeof rsOpts.minIdleMs === 'number' ? rsOpts.minIdleMs : 60_000
      const claimBatch = typeof rsOpts.claimBatch === 'number' ? rsOpts.claimBatch : 100
      const autoClaimIntervalMs = typeof rsOpts.autoClaimIntervalMs === 'number' ? rsOpts.autoClaimIntervalMs : 30_000
      let groupEnsured = false
      let claimTimer: any

      const runSimple = async () => {
        while (running && !closed) {
          try {
            await ensure()
            const res = await (redis as any).xread(
              { BLOCK: blockMs, COUNT: count },
              'STREAMS',
              stream,
              lastId,
            )
            if (!res) continue
            for (const [_s, entries] of res as any[]) {
              for (const [id, arr] of entries) {
                lastId = id
                try {
                  const rec = parseFieldsToRecord(id, arr)
                  rec.stream = stream
                  onEvent(rec)
                }
                catch {
                  // ignore
                }
              }
            }
          }
          catch {
            await new Promise(r => setTimeout(r, 500))
          }
        }
      }

      const runGroup = async (group: string, consumer: string) => {
        if (rsOpts.createGroupIfMissing && !groupEnsured) {
          try {
            await (redis as any).xgroup('CREATE', stream, group, '$', 'MKSTREAM')
          }
          catch {
            // BUSYGROUP expected when exists
          }
          groupEnsured = true
        }

        const startAutoClaim = () => {
          if (claimTimer) return
          claimTimer = setInterval(async () => {
            if (!running || closed) return
            try {
              await ensure()
              let start = '0-0'
              let keepGoing = true
              while (keepGoing && running && !closed) {
                const res = await (redis as any).xautoclaim(stream, group, consumer, minIdleMs, start, 'COUNT', claimBatch)
                if (!res || !Array.isArray(res) || res.length < 2) break
                const nextStart = res[0]
                const entries = res[1] || []
                if (!entries.length) {
                  keepGoing = false
                }
                for (const [id, arr] of entries as any[]) {
                  try {
                    const rec = parseFieldsToRecord(id, arr)
                    rec.stream = stream
                    onEvent(rec)
                    await (redis as any).xack(stream, group, id)
                  }
                  catch {
                    // ignore
                  }
                }
                start = nextStart
                if (entries.length < claimBatch) keepGoing = false
              }
            }
            catch {
              // ignore
            }
          }, autoClaimIntervalMs)
        }

        startAutoClaim()

        while (running && !closed) {
          try {
            await ensure()
            const res = await (redis as any).xreadgroup(
              'GROUP', group, consumer,
              'BLOCK', blockMs,
              'COUNT', count,
              'STREAMS', stream,
              '>',
            )
            if (!res) continue
            for (const [_s, entries] of res as any[]) {
              for (const [id, arr] of entries) {
                try {
                  const rec = parseFieldsToRecord(id, arr)
                  rec.stream = stream
                  onEvent(rec)
                  await (redis as any).xack(stream, group, id)
                }
                catch {
                  // ignore
                }
              }
            }
          }
          catch {
            await new Promise(r => setTimeout(r, 500))
          }
        }

        if (claimTimer) {
          clearInterval(claimTimer)
          claimTimer = undefined
        }
      }

      ;(async () => {
        if (rsOpts.group && rsOpts.consumer) {
          await runGroup(rsOpts.group, rsOpts.consumer)
        }
        else {
          await runSimple()
        }
      })()
      return {
        unsubscribe() {
          running = false
        },
      }
    },
    async close(): Promise<void> {
      closed = true
      try {
        await redis.quit()
      }
      catch {
        // ignore
      }
    },
  }
}
