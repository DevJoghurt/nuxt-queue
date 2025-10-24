import type { Job as BullJob } from 'bullmq'
import { getStateProvider } from '../../state/stateFactory'
import { useRuntimeConfig, useMetrics, useLogs, useEventManager } from '#imports'

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
      const state = getStateProvider()
      const rc: any = useRuntimeConfig()
      const cleanupCfg = rc?.queue?.state?.cleanup || { strategy: 'never' }
      return {
        async get(key) { return state.get(scopeKey(key, partial?.traceId)) },
        async set(key, value, opts) {
          const ttl = opts?.ttl ?? (cleanupCfg?.strategy === 'ttl' ? cleanupCfg?.ttlMs : undefined)
          return state.set(scopeKey(key, partial?.traceId), value, ttl ? { ttl } : undefined)
        },
        async delete(key) { return state.delete(scopeKey(key, partial?.traceId)) },
      }
    }
    catch {
      return defaultState
    }
  })()
  // Default emit via EventManager (publishes to adapter + in-proc bus)
  const emit = partial?.emit || (async (evt: any) => {
    const kind = typeof evt?.kind === 'string' ? evt.kind : 'runner.event'
    const data = evt?.data ?? evt
    const { incCounter } = useMetrics()
    try {
      incCounter('runner_emits_total', { kind })
    }
    catch {
      // ignore
    }
    const mgr = useEventManager()
    await mgr.publish({ kind, data, meta: evt?.meta }, { queue: partial?.queue, jobId: partial?.jobId, flowId: partial?.traceId })
  })
  // Logger bridge: use provider; also mirror to events as runner.log
  const logger: RunLogger = partial?.logger || (() => {
    const logs = useLogs()
    return {
      log: (level, msg, meta) => {
        // publish runner.log via EventManager; ignore failures
        void logs.publishLog(level as any, msg, meta, { queue: partial?.queue, jobId: partial?.jobId, flowId: partial?.traceId })
      },
    }
  })()
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
      const sp = getStateProvider()
      const prefix = scopeKey('', ctx.traceId)
      const { keys } = await sp.list(prefix)
      await Promise.all(keys.map(k => sp.delete(k.replace(/^flow:[^:]*:/, ''))))
    }
    return result
  }
}
