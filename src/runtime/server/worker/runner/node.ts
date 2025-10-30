import type { Job as BullJob } from 'bullmq'
import { randomUUID } from 'node:crypto'
import { getStateProvider } from '../../state/stateFactory'
import { useRuntimeConfig, useMetrics, useLogs, useEventManager, useFlowEngine } from '#imports'

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
  flowId?: string
  flowName?: string
  stepName?: string
  stepId?: string
  attempt?: number
  logger: RunLogger
  state: RunState
  emit: (evt: any) => void
  flow: ReturnType<typeof useFlowEngine>
}

const defaultState: RunState = {
  async get() { return null },
  async set() { /* no-op */ },
  async delete() { /* no-op */ },
}

function scopeKey(baseKey: string, flowId?: string) {
  if (!flowId) return baseKey
  // Prefix with flow trace namespace to isolate per-flow state
  return `flow:${flowId}:${baseKey}`
}

export function buildContext(partial?: Partial<RunContext>): RunContext {
  // Provide a lazy StateProvider so ctx.state works without explicit wiring at callsites
  const state = partial?.state || ((): RunState => {
    try {
      const state = getStateProvider()
      const rc: any = useRuntimeConfig()
      const cleanupCfg = rc?.queue?.state?.cleanup || { strategy: 'never' }
      return {
        async get(key) { return state.get(scopeKey(key, partial?.flowId)) },
        async set(key, value, opts) {
          const ttl = opts?.ttl ?? (cleanupCfg?.strategy === 'ttl' ? cleanupCfg?.ttlMs : undefined)
          return state.set(scopeKey(key, partial?.flowId), value, ttl ? { ttl } : undefined)
        },
        async delete(key) { return state.delete(scopeKey(key, partial?.flowId)) },
      }
    }
    catch {
      return defaultState
    }
  })()
  // Default emit via EventManager (publishes to adapter + in-proc bus)
  const emit = partial?.emit || (async (evt: any) => {
    const type = typeof evt?.type === 'string' ? evt.type : (evt?.kind || 'runner.event')
    const data = evt?.data ?? evt
    const { incCounter } = useMetrics()
    try {
      incCounter('runner_emits_total', { type })
    }
    catch {
      // ignore
    }
    const mgr = useEventManager()
    // v0.4: Build event with new schema
    // Priority: explicit event fields > meta fields > partial context
    const runId = evt?.runId || partial?.flowId || 'unknown'
    const flowName = evt?.flowName || (evt?.meta as any)?.flowName || partial?.flowName || 'unknown'
    const stepName = evt?.stepName || (evt?.meta as any)?.stepName || partial?.stepName
    const stepId = evt?.stepId || (evt?.meta as any)?.stepId || partial?.stepId
    const attempt = evt?.attempt !== undefined ? evt?.attempt : (evt?.meta as any)?.attempt

    await mgr.publishBus({
      type,
      runId,
      flowName,
      stepName,
      stepId,
      attempt,
      data,
    })
  })
  // Logger bridge: use provider; also mirror to events as runner.log
  const logger: RunLogger = partial?.logger || (() => {
    const logs = useLogs()
    return {
      log: (level, msg, meta) => {
        // publish runner.log; ignore failures
        const mergedMeta = { ...(meta || {}) }
        void logs.publishLog(level as any, msg, mergedMeta, { queue: partial?.queue, jobId: partial?.jobId, flowId: partial?.flowId })
      },
    }
  })()
  // Flow engine for trigger handling - bind to context for automatic flowId/flowName
  const baseFlowEngine = useFlowEngine()
  const flow = {
    ...baseFlowEngine,
    handleTrigger: async (trigger: string, payload: any = {}) => {
      // Auto-inject flowId and flowName from context if not provided
      const enrichedPayload = {
        ...payload,
        flowId: payload.flowId || partial?.flowId,
        flowName: payload.flowName || partial?.flowName,
      }
      return baseFlowEngine.handleTrigger(trigger, enrichedPayload)
    },
  }

  return {
    jobId: partial?.jobId,
    queue: partial?.queue,
    flowId: partial?.flowId,
    flowName: partial?.flowName,
    stepName: partial?.stepName,
    stepId: partial?.stepId,
    attempt: partial?.attempt,
    logger,
    state,
    emit,
    flow,
  }
}

export type NodeHandler = (input: any, ctx: RunContext) => Promise<any>

export function createBullMQProcessor(handler: NodeHandler, queueName: string) {
  return async function processor(job: BullJob) {
    const rc: any = useRuntimeConfig()
    const autoScope: 'always' | 'flow' | 'never' = rc?.queue?.state?.autoScope || 'always'
    const providedFlow = job.data?.flowId
    // v0.4: Always use a proper flow identifier (UUID for new flows, never job ID)
    const flowId = providedFlow || (autoScope === 'always' ? randomUUID() : undefined)

    // Attempt number (provider-derived in future); placeholder 1 for now
    const attempt = 1
    // Generate a unique stepRunId for this attempt
    const stepRunId = `${String(flowId || job.id)}__${job.name}__attempt-${attempt}`
    // Get flowName for v0.4 events
    const flowName = (job.data as any)?.flowName || 'unknown'

    const ctx = buildContext({
      jobId: job.id as string,
      queue: queueName,
      flowId,
      flowName,
      stepName: job.name,
      stepId: stepRunId,
      attempt,
    })

    // Derive a logger that injects stepName/attempt/stepRunId by default during this attempt
    const attemptLogger = {
      log: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: any) => {
        const enriched = { ...(meta || {}), stepName: job.name, attempt, stepRunId, flowName }
        ctx.logger.log(level, msg, enriched)
      },
    }
    // v0.4: Emit step.started event
    try {
      await ctx.emit({
        type: 'step.started',
        flowName,
        stepName: job.name,
        stepId: stepRunId,
        attempt,
        data: { jobId: job.id, name: job.name, queue: queueName },
      })
    }
    catch {
      // best-effort; don't fail job if emit fails
    }
    let result: any
    try {
      // Pass a context that includes the attempt-aware logger
      result = await handler(job.data, { ...ctx, logger: attemptLogger })
    }
    catch (err) {
      // v0.4: Emit step.failed event
      try {
        await ctx.emit({
          type: 'step.failed',
          flowName,
          stepName: job.name,
          stepId: stepRunId,
          attempt,
          data: { stepName: job.name, queue: queueName, error: String((err as any)?.message || err) },
        })
      }
      catch {
        // ignore
      }
      throw err
    }
    // v0.4: Emit step.completed event
    try {
      await ctx.emit({
        type: 'step.completed',
        flowName,
        stepName: job.name,
        stepId: stepRunId,
        attempt,
        data: { stepName: job.name, queue: queueName, result },
      })
    }
    catch {
      // ignore
    }
    const cleanup = rc?.queue?.state?.cleanup || { strategy: 'never' }
    if (ctx.flowId && (cleanup.strategy === 'on-complete' || cleanup.strategy === 'immediate')) {
      const sp = getStateProvider()
      const prefix = scopeKey('', ctx.flowId)
      const { keys } = await sp.list(prefix)
      await Promise.all(keys.map(k => sp.delete(k.replace(/^flow:[^:]*:/, ''))))
    }
    return result
  }
}
