import type { Job as BullJob } from 'bullmq'
import { randomUUID } from 'node:crypto'
import { getStateProvider } from '../../state/stateFactory'
import { useRuntimeConfig, useLogs, useFlowEngine, useEventManager } from '#imports'

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
    emit: async (trigger: string, payload: any = {}) => {
      // Auto-inject flowId and flowName from context if not provided
      const enrichedPayload = {
        ...payload,
        flowId: payload.flowId || partial?.flowId,
        flowName: payload.flowName || partial?.flowName,
      }
      return baseFlowEngine.emit(trigger, enrichedPayload)
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
    flow,
  }
}

export type NodeHandler = (input: any, ctx: RunContext) => Promise<any>

export function createBullMQProcessor(handler: NodeHandler, queueName: string) {
  return async function processor(job: BullJob) {
    // Check if this is a scheduled flow start trigger
    if (job.data?.__scheduledFlowStart) {
      const { __flowName, __flowInput } = job.data
      try {
        // Dynamically import to avoid circular dependencies
        const { startFlow } = useFlowEngine()
        const result = await startFlow(__flowName, __flowInput || {})
        return {
          scheduled: true,
          flowId: result.flowId,
          flowName: __flowName,
        }
      }
      catch (err: any) {
        console.error('[scheduled-flow] Failed to start flow:', err)
        throw err
      }
    }

    // Normal job processing
    const eventMgr = useEventManager()
    const rc: any = useRuntimeConfig()
    const autoScope: 'always' | 'flow' | 'never' = rc?.queue?.state?.autoScope || 'always'
    const providedFlow = job.data?.flowId
    // v0.4: Always use a proper flow identifier (UUID for new flows, never job ID)
    const flowId = providedFlow || (autoScope === 'always' ? randomUUID() : undefined)

    // Get actual attempt number from BullMQ (1-indexed: attemptsMade starts at 0)
    const attempt = (job.attemptsMade || 0) + 1
    const maxAttempts = job.opts?.attempts || 1
    const isFinalAttempt = attempt >= maxAttempts

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
      await eventMgr.publishBus({
        type: 'step.started',
        runId: flowId || 'unknown',
        flowName,
        stepName: job.name,
        stepId: stepRunId,
        attempt,
        data: { jobId: job.id, name: job.name, queue: queueName } as any,
      })
    }
    catch {
      // best-effort; don't fail job if emit fails
    }
    let result: any
    try {
      // Determine input based on whether this is an entry step or has dependencies
      // Entry steps: pass job.data directly
      // Non-entry steps (with subscribes): pass job.data.input (keyed by event name)
      const workerInput = job.data?.input !== undefined ? job.data.input : job.data

      // Pass a context that includes the attempt-aware logger
      result = await handler(workerInput, { ...ctx, logger: attemptLogger })
    }
    catch (err) {
      // Log the error to console for debugging
      console.error(`[worker] Job failed: ${job.name} (${job.id})`, {
        queue: queueName,
        flowId,
        flowName,
        stepName: job.name,
        error: (err as any)?.message || String(err),
        stack: (err as any)?.stack,
      })

      // Determine if this is a retry or final failure
      const willRetry = !isFinalAttempt

      if (willRetry) {
        // v0.4: Emit step.retry event
        try {
          await eventMgr.publishBus({
            type: 'step.retry' as any,
            runId: flowId || 'unknown',
            flowName,
            stepName: job.name,
            stepId: stepRunId,
            attempt,
            data: {
              stepName: job.name,
              queue: queueName,
              error: String((err as any)?.message || err),
              stack: (err as any)?.stack,
              attempt,
              maxAttempts,
              nextAttempt: attempt + 1,
            } as any,
          })
        }
        catch {
          // ignore
        }
      }
      else {
        // v0.4: Emit step.failed event (final failure)
        try {
          const eventMgr = useEventManager()
          await eventMgr.publishBus({
            type: 'step.failed',
            runId: flowId || 'unknown',
            flowName,
            stepName: job.name,
            stepId: stepRunId,
            attempt,
            data: {
              error: String((err as any)?.message || err),
              stack: (err as any)?.stack,
            },
          })
        }
        catch {
          // ignore
        }
      }
      throw err
    }
    // v0.4: Emit step.completed event
    try {
      const eventMgr = useEventManager()
      await eventMgr.publishBus({
        type: 'step.completed',
        runId: flowId || 'unknown',
        flowName,
        stepName: job.name,
        stepId: stepRunId,
        attempt,
        data: { result },
      })
    }
    catch {
      // ignore
    }

    return result
  }
}
