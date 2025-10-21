import type { EventRecord, EventReadOptions, EventStoreProvider, EventSubscription } from './contracts'
import { useRuntimeConfig } from '#imports'
import IORedis from 'ioredis'

function nowIso() {
  return new Date().toISOString()
}

export function createRedisStreamsEventStore(): EventStoreProvider {
  const rc: any = useRuntimeConfig()
  const conn = rc?.queue?.redis || {}
  const rsOpts = (rc?.queue?.eventStore?.options?.redisStreams || {}) as {
    group?: string
    consumer?: string
    blockMs?: number
    count?: number
    createGroupIfMissing?: boolean
    // trimming options
    trim?: { maxLen?: number, approx?: boolean }
    // claiming stale messages
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

  return {
    async append<T = any>(stream: string, e: Omit<EventRecord<T>, 'id' | 'ts' | 'stream'>): Promise<EventRecord<T>> {
      if (!redis.status || redis.status === 'end') await redis.connect()
      const payload = JSON.stringify({ ...e, ts: nowIso(), stream })
      // Let Redis assign the ID ("*") and optionally trim the stream
      let id: string
      if (rsOpts?.trim?.maxLen && rsOpts.trim.maxLen > 0) {
        const approx = rsOpts?.trim?.approx !== false
        const args = approx ? ['MAXLEN', '~', String(rsOpts.trim.maxLen)] : ['MAXLEN', String(rsOpts.trim.maxLen)]
        id = await (redis as any).xadd(stream, ...args, '*', 'e', payload)
      }
      else {
        id = await (redis as any).xadd(stream, '*', 'e', payload)
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
        // Read backward using XREVRANGE, starting from fromId (exclusive) or '+'
        resp = await (redis as any).xrevrange(stream, from === '0-0' ? '+' : `(${from}`, '-', 'COUNT', count)
      }
      else {
        resp = await (redis as any).xrange(stream, from === '0-0' ? '-' : `(${from}`, '+', 'COUNT', count)
      }
      const out: EventRecord[] = []
      for (const [id, arr] of resp as any[]) {
        const idx = arr.findIndex((v: string) => v === 'e')
        if (idx >= 0 && arr[idx + 1]) {
          try {
            const parsed = JSON.parse(arr[idx + 1])
            out.push({ id, ...parsed })
          }
          catch {
            // ignore malformed record
          }
        }
      }
      return out
    },
    async subscribe(stream: string, onEvent: (e: EventRecord) => void): Promise<EventSubscription> {
      // Tail using simple XREAD or consumer groups if configured
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
                const idx = arr.findIndex((v: string) => v === 'e')
                if (idx >= 0 && arr[idx + 1]) {
                  try {
                    const parsed = JSON.parse(arr[idx + 1])
                    onEvent({ id, ...parsed })
                  }
                  catch {
                    // ignore malformed record
                  }
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
        // Ensure group once (MKSTREAM to avoid missing stream errors)
        if (rsOpts.createGroupIfMissing && !groupEnsured) {
          try {
            await (redis as any).xgroup('CREATE', stream, group, '$', 'MKSTREAM')
          }
          catch {
            // BUSYGROUP is fine
          }
          groupEnsured = true
        }

        // background auto-claim for stale pending messages
        const startAutoClaim = () => {
          if (claimTimer) return
          claimTimer = setInterval(async () => {
            if (!running || closed) return
            try {
              await ensure()
              // XAUTOCLAIM stream group consumer minIdle start count
              // start from '0-0' to iterate
              let start = '0-0'
              let keepGoing = true
              while (keepGoing && running && !closed) {
                const res = await (redis as any).xautoclaim(stream, group, consumer, minIdleMs, start, 'COUNT', claimBatch)
                // res: [nextId, [ [id, [field, value, ...]], ... ]]
                if (!res || !Array.isArray(res) || res.length < 2) break
                const nextStart = res[0]
                const entries = res[1] || []
                if (!entries.length) {
                  keepGoing = false
                }
                for (const [id, arr] of entries as any[]) {
                  const idx = arr.findIndex((v: string) => v === 'e')
                  if (idx >= 0 && arr[idx + 1]) {
                    try {
                      const parsed = JSON.parse(arr[idx + 1])
                      onEvent({ id, ...parsed })
                      await (redis as any).xack(stream, group, id)
                    }
                    catch {
                      // ignore malformed record
                    }
                  }
                }
                start = nextStart
                // Avoid tight loop
                if (entries.length < claimBatch) keepGoing = false
              }
            }
            catch {
              // ignore errors in claim loop
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
                const idx = arr.findIndex((v: string) => v === 'e')
                if (idx >= 0 && arr[idx + 1]) {
                  try {
                    const parsed = JSON.parse(arr[idx + 1])
                    onEvent({ id, ...parsed })
                    // Ack after processing
                    await (redis as any).xack(stream, group, id)
                  }
                  catch {
                    // ignore malformed record
                  }
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
          if (claimTimer) {
            try {
              clearInterval(claimTimer)
            }
            catch {
              // ignore
            }
            claimTimer = undefined
          }
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
