import { useRuntimeConfig } from '#imports'
import { getEventBus } from '../streams/eventBus'
import { getStreamFactory } from '../streams/streamFactory'
import type { PublishPayload, PublishContext, EventRecord } from '../streams/types'

export interface EventManager {
  publish(evt: PublishPayload, ctx?: PublishContext): Promise<void>
  onKind: ReturnType<typeof getEventBus>['onKind']
  subscribeStream: ReturnType<typeof getEventBus>['subscribeStream']
  getStreamNames(): typeof getStreamFactory extends () => infer R ? R extends { names: infer N } ? N : never : never
  /**
   * Generic read helper over the underlying adapter.
   * - Supports forward/backward reads
   * - Optional filter callback
   * - Optional pagination with nextFromId cursor
   */
  read(opts: {
    stream: string
    limit?: number
    fromId?: string
    direction?: 'forward' | 'backward'
    filter?: (e: EventRecord) => boolean
    paged?: boolean
    batchFactor?: number
    minBatch?: number
  }): Promise<EventRecord[] | { items: EventRecord[], nextFromId?: string }>
}

let cached: EventManager | null = null

// Internal getter (no `use` prefix). Utils wrapper will expose `useEventManager`.
export function useEventManager(): EventManager {
  if (cached) return cached
  const bus = getEventBus()
  const factory = getStreamFactory()
  const rc: any = useRuntimeConfig()
  const DEBUG = rc?.queue?.debug?.events || process.env.NQ_DEBUG_EVENTS === '1'

  const getStreamNames = () => {
    return factory.names
  }

  const publish: EventManager['publish'] = async (evt, ctx) => {
    const kind = typeof evt?.kind === 'string' ? evt.kind : 'event'
    const data = evt?.data
    const subject = evt?.subject
    const correlationId = evt?.correlationId || ctx?.flowId
    const causationId = evt?.causationId || ctx?.jobId

    const base = {
      kind,
      subject: subject || ctx?.queue,
      data,
      meta: evt?.meta,
      correlationId,
      causationId,
      v: 1,
    }

    const streamsCfg = factory.names
    const streams = [
      streamsCfg.global,
      ctx?.queue ? (typeof (streamsCfg as any).queue === 'function' ? (streamsCfg as any).queue(ctx.queue) : String((streamsCfg as any).queue) + String(ctx.queue)) : null,
      ctx?.jobId ? (typeof (streamsCfg as any).job === 'function' ? (streamsCfg as any).job(ctx.jobId) : String((streamsCfg as any).job) + String(ctx.jobId)) : null,
      (correlationId || ctx?.flowId) ? (typeof (streamsCfg as any).flow === 'function' ? (streamsCfg as any).flow(String(correlationId || ctx?.flowId)) : String((streamsCfg as any).flow) + String(correlationId || ctx?.flowId)) : null,
    ].filter(Boolean) as string[]

    for (const s of streams) {
      const rec = await factory.adapter.append(s, base as any)
      bus.publish(rec)
      if (DEBUG) {
        try {
          console.log('[nq][event-manager.publish]', { kind, stream: s, id: rec.id, subject: rec.subject, corr: rec.correlationId, cause: rec.causationId })
        }
        catch {
          // ignore
        }
      }
    }
  }

  // Subscribe to a concrete stream using the underlying adapter (not only the in-proc bus)
  const subscribeStream: EventManager['subscribeStream'] = (stream: string, handler: (e: EventRecord) => void) => {
    let active = true
    let sub: { unsubscribe(): void } | null = null
    // Bridge adapter subscription; avoid republishing to bus here to prevent duplicates
    factory.adapter.subscribe(stream, (e) => {
      if (active) handler(e)
    })
      .then((s) => {
        if (!active) {
          s.unsubscribe()
        }
        else {
          sub = s
        }
      })
      .catch(() => {
        // no-op
      })
    return () => {
      active = false
      if (sub) {
        try {
          sub.unsubscribe()
        }
        catch {
          // ignore
        }
      }
    }
  }

  // Subscribe by kind by listening on the global stream from the adapter and filtering
  const onKind: EventManager['onKind'] = (kind: string, handler: (e: EventRecord) => void) => {
    const streams = factory.names
    const global = streams.global
    return subscribeStream(global, (e) => {
      if (e.kind === kind) handler(e)
    })
  }

  // Generic read with optional pagination
  const read: EventManager['read'] = async (opts) => {
    const limit = opts.limit ?? 200
    const direction = opts.direction || 'forward'
    const paged = !!opts.paged
    const batchFactor = opts.batchFactor ?? 5
    const minBatch = opts.minBatch ?? 200
    const batch = paged ? Math.max(limit * batchFactor, minBatch) : limit

    const recs = await factory.adapter.read(opts.stream, { limit: batch, fromId: opts.fromId, direction })
    const filtered = opts.filter ? recs.filter(opts.filter) : recs

    if (paged) {
      const items = filtered.slice(0, limit)
      const nextFromId = recs.length >= batch ? recs[recs.length - 1]?.id : undefined
      return { items, nextFromId }
    }
    return filtered.slice(0, limit)
  }

  cached = { publish, onKind, subscribeStream, getStreamNames, read }
  return cached
}

export function setEventManager(mgr: EventManager) {
  cached = mgr
}
