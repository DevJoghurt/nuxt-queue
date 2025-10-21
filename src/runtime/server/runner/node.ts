import type { Job as BullJob } from 'bullmq'
import { useStateProvider } from '../providers/state'
import { useRuntimeConfig, $useLoggerProvider, useMetrics, $useEventStoreProvider, $useEventBus, $useStreamNames } from '#imports'

export interface RunLogger {
  log: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: any) => void
}

export interface RunState {
  get<T = any>(key: string): Promise<T | null>
  set<T = any>(key: string, value: T, opts?: { ttl?: number }): Promise<void>
  delete(key: string): Promise<void>
}

export interface RunContext {
  jobId?: string
  queue?: string
  traceId?: string
  logger: RunLogger
  state: RunState
  emit: (evt: any) => void
}

// Minimal default context impls; will be replaced by providers later
const defaultLogger: RunLogger = {
  log: (level, msg, meta) => {
    // Fallback to console if provider not available
    console[level === 'debug' ? 'log' : level](`[runner] ${msg}`, meta || '')
  },
}

const defaultState: RunState = {
  async get() { return null },
  async set() { /* no-op */ },
  async delete() { /* no-op */ },
}

function scopeKey(baseKey: string, traceId?: string) {
  if (!traceId) return baseKey
  // Prefix with flow trace namespace to isolate per-flow state
  return `flow:${traceId}:${baseKey}`
}

export function buildContext(partial?: Partial<RunContext>): RunContext {
  // Provide a lazy StateProvider so ctx.state works without explicit wiring at callsites
  const state = partial?.state || ((): RunState => {
    try {
      const provider = useStateProvider()
      const rc: any = useRuntimeConfig()
      const cleanupCfg = rc?.queue?.state?.cleanup || { strategy: 'never' }
      return {
        async get(key) { return provider.get(scopeKey(key, partial?.traceId)) },
        async set(key, value, opts) {
          const ttl = opts?.ttl ?? (cleanupCfg?.strategy === 'ttl' ? cleanupCfg?.ttlMs : undefined)
          return provider.set(scopeKey(key, partial?.traceId), value, ttl ? { ttl } : undefined)
        },
        async delete(key) { return provider.delete(scopeKey(key, partial?.traceId)) },
      }
    }
    catch {
      return defaultState
    }
  })()
  // Default emit that appends to event store and publishes on in-proc bus
  const emit = partial?.emit || (async (evt: any) => {
    const { publish: publishEvent } = $useEventBus()
    const kind = typeof evt?.kind === 'string' ? evt.kind : 'runner.event'
    const data = evt?.data ?? evt
    const base = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      ts: new Date().toISOString(),
      kind,
      subject: partial?.queue,
      data,
      meta: evt?.meta,
      correlationId: partial?.traceId,
      causationId: partial?.jobId,
      v: 1,
    }
    const streamsCfg = $useStreamNames()
    const streams = [
      streamsCfg.global,
      partial?.queue ? (typeof (streamsCfg as any).queue === 'function' ? (streamsCfg as any).queue(partial.queue) : String((streamsCfg as any).queue) + String(partial.queue)) : null,
      partial?.jobId ? (typeof (streamsCfg as any).job === 'function' ? (streamsCfg as any).job(partial.jobId) : String((streamsCfg as any).job) + String(partial.jobId)) : null,
      partial?.traceId ? (typeof (streamsCfg as any).flow === 'function' ? (streamsCfg as any).flow(partial.traceId) : String((streamsCfg as any).flow) + String(partial.traceId)) : null,
    ].filter(Boolean) as string[]
    const store = $useEventStoreProvider()
    const { incCounter } = useMetrics()
    for (const s of streams) {
      try {
        incCounter('runner_emits_total', { kind, stream: s })
      }
      catch {
        // ignore
      }
      const rec = await store.append(s, base)
      publishEvent(rec)
    }
  })
  // Logger bridge: use provider; also mirror to events as runner.log
  const providerLogger = (() => {
    try {
      return $useLoggerProvider()
    }
    catch {
      return null
    }
  })()
  const logger: RunLogger = partial?.logger || (providerLogger
    ? (() => {
        const rc: any = useRuntimeConfig()
        const providerName = rc?.queue?.logger?.name || 'console'
        // Bind context to logger so streams can be derived
        const bound = providerLogger.child({ queue: partial?.queue, jobId: partial?.jobId, traceId: partial?.traceId })
        return {
          log: (level, msg, meta) => {
            try {
              bound.log(level as any, msg, meta)
            }
            catch {
              // ignore provider logger failure
            }
            if (providerName !== 'redis') {
              // emit a runner.log event for observability when provider doesn't persist
              try {
                emit({ kind: 'runner.log', data: { level, msg, meta } })
              }
              catch {
                // ignore emit failure
              }
            }
          },
        }
      })()
    : defaultLogger)
  return {
    jobId: partial?.jobId,
    queue: partial?.queue,
    traceId: partial?.traceId,
    logger,
    state,
    emit,
  }
}

export type NodeHandler = (input: any, ctx: RunContext) => Promise<any>

export function createBullMQProcessor(handler: NodeHandler, queueName: string) {
  return async function processor(job: BullJob) {
    const rc: any = useRuntimeConfig()
    const autoScope: 'always' | 'flow' | 'never' = rc?.queue?.state?.autoScope || 'always'
    const providedTrace = job.data && (job.data.traceId || job.data.correlationId)
    const traceId = providedTrace ? (job.data.traceId || job.data.correlationId) : (autoScope === 'always' ? String(job.id) : undefined)

    const ctx = buildContext({ jobId: job.id as string, queue: queueName, traceId })
    // Emit a step-named event so flows can trigger on simple kinds like 'start', 'next', etc.
    try {
      await ctx.emit({ kind: job.name, data: { jobId: job.id, name: job.name, queue: queueName } })
    }
    catch {
      // best-effort; don't fail job if emit fails
    }
    const result = await handler(job.data, ctx)
    const cleanup = rc?.queue?.state?.cleanup || { strategy: 'never' }
    if (ctx.traceId && (cleanup.strategy === 'on-complete' || cleanup.strategy === 'immediate')) {
      const sp = useStateProvider()
      const prefix = scopeKey('', ctx.traceId)
      const { keys } = await sp.list(prefix)
      await Promise.all(keys.map(k => sp.delete(k.replace(/^flow:[^:]*:/, ''))))
    }
    return result
  }
}
