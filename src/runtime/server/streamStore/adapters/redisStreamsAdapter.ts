import type { StreamAdapter, EventReadOptions, EventSubscription } from '../types'
import type { EventRecord } from '../../../types'
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

  // Separate connection for Pub/Sub SUBSCRIBE (v0.4 real-time)
  // NOTE: Once a connection enters subscriber mode (via SUBSCRIBE), it can ONLY
  // execute subscriber commands. Regular commands like PUBLISH, XADD, etc. will fail.
  const subscriber = new IORedis({
    host: conn.host,
    port: conn.port,
    username: conn.username,
    password: conn.password,
    lazyConnect: true,
  })

  function buildFields(e: any) {
    // v0.4: Store type, runId, flowName, and optional step fields
    const dataStr = e.data !== undefined ? JSON.stringify(e.data) : ''
    const fields: Array<string> = [
      'type', String(e.type || ''),
      'runId', String(e.runId || ''),
      'flowName', String(e.flowName || ''),
      'data', dataStr,
      'ts', e.ts || nowIso(),
    ]

    // Add optional step fields only if present
    if (e.stepName) {
      fields.push('stepName', String(e.stepName))
    }
    if (e.stepId) {
      fields.push('stepId', String(e.stepId))
    }
    if (e.attempt !== undefined) {
      fields.push('attempt', String(e.attempt))
    }

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
    try {
      data = obj.data ? JSON.parse(obj.data) : undefined
    }
    catch {
      data = undefined
    }

    // v0.4: Build clean event record with required fields
    const rec: any = {
      id,
      ts: obj.ts || nowIso(),
      type: obj.type || 'event',
      runId: obj.runId || '',
      flowName: obj.flowName || '',
      data,
    }

    // Add optional step fields if present
    if (obj.stepName) rec.stepName = obj.stepName
    if (obj.stepId) rec.stepId = obj.stepId
    if (obj.attempt) rec.attempt = Number.parseInt(obj.attempt, 10)

    return rec
  }

  return {
    async append(subject: string, e: Omit<EventRecord, 'id' | 'ts'>): Promise<EventRecord> {
      if (!redis.status || redis.status === 'end') await redis.connect()

      const ts = nowIso()
      const payloadFields = buildFields({ ...(e as any), ts })

      // Stream name: nq:<type>:<id> (e.g., nq:flow:run-123, nq:trigger:webhook-abc)
      const stream = subject

      let id: string
      if (rsOpts?.trim?.maxLen && rsOpts.trim.maxLen > 0) {
        const approx = rsOpts?.trim?.approx !== false
        const args = approx ? ['MAXLEN', '~', String(rsOpts.trim.maxLen)] : ['MAXLEN', String(rsOpts.trim.maxLen)]
        id = await (redis as any).xadd(stream, ...args, '*', ...payloadFields)
      }
      else {
        id = await (redis as any).xadd(stream, '*', ...payloadFields)
      }

      // v0.4: PUBLISH to channel after XADD for real-time notifications
      // NOTE: Must use the normal redis connection, NOT subscriber connection
      // because PUBLISH is a regular command, not a subscriber command
      const channel = `nq:events:${subject}`
      await redis.publish(channel, id)

      if (process.env.NQ_DEBUG_EVENTS === '1') {
        console.log('[redis-streams] appended and published', { stream, id, channel, type: (e as any).type })
      }

      const rec = { ...(e as any), id, ts, subject }
      return rec
    },
    async read(subject: string, opts?: EventReadOptions): Promise<EventRecord[]> {
      if (!redis.status || redis.status === 'end') await redis.connect()
      const from = opts?.fromId ? opts.fromId : '0-0'
      const count = opts?.limit || 100
      const dir = opts?.direction || 'forward'

      const stream = subject
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
          out.push(rec)
        }
        catch {
          // ignore
        }
      }
      return out
    },
    async subscribe(subject: string, onEvent: (e: EventRecord) => void): Promise<EventSubscription> {
      // v0.3: Use Redis Pub/Sub for real-time events instead of XREAD polling
      const stream = subject
      const channel = `nq:events:${subject}`

      if (!subscriber.status || subscriber.status === 'end') await subscriber.connect()
      if (!redis.status || redis.status === 'end') await redis.connect()

      let running = true

      if (process.env.NQ_DEBUG_EVENTS === '1') {
        console.log('[redis-streams] subscribing via Pub/Sub', { stream, channel })
      }

      // Handle incoming Pub/Sub messages
      const messageHandler = async (ch: string, messageId: string) => {
        if (ch !== channel || !running) return

        try {
          // Fetch the event from the stream using the message ID
          const entries = await (redis as any).xrange(stream, messageId, messageId, 'COUNT', 1)
          if (entries && entries.length > 0) {
            const [id, arr] = entries[0]
            const rec = parseFieldsToRecord(id, arr)

            if (process.env.NQ_DEBUG_EVENTS === '1') {
              console.log('[redis-streams] received event via Pub/Sub', { stream, id, type: rec.type })
            }

            onEvent(rec)
          }
        }
        catch (err) {
          if (process.env.NQ_DEBUG_EVENTS === '1') {
            console.error('[redis-streams] Pub/Sub message handling error:', err)
          }
        }
      }

      subscriber.on('message', messageHandler)
      await subscriber.subscribe(channel)

      return {
        unsubscribe() {
          running = false
          subscriber.off('message', messageHandler)
          subscriber.unsubscribe(channel).catch(() => {
            // ignore
          })
        },
      }
    },
    async indexAdd(key: string, id: string, score: number): Promise<void> {
      if (!redis.status || redis.status === 'end') await redis.connect()
      await redis.zadd(key, score, id)
    },
    async indexRead(key: string, opts?: { offset?: number, limit?: number }) {
      if (!redis.status || redis.status === 'end') await redis.connect()

      const offset = opts?.offset || 0
      const limit = opts?.limit || 50
      const end = offset + limit - 1

      // Read from sorted set in reverse order (newest first) with scores
      const results = await redis.zrevrange(key, offset, end, 'WITHSCORES')

      // Results alternate between member and score
      const entries: Array<{ id: string, score: number }> = []
      for (let i = 0; i < results.length; i += 2) {
        entries.push({
          id: results[i],
          score: Number.parseInt(results[i + 1]),
        })
      }

      return entries
    },
    async close(): Promise<void> {
      try {
        await redis.quit()
        await subscriber.quit()
      }
      catch {
        // ignore
      }
    },
  }
}
