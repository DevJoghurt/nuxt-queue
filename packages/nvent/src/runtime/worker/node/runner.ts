import { randomUUID } from 'node:crypto'
import {
  useRuntimeConfig,
  useFlow,
  useEventManager,
  useNventLogger,
  $useFunctionRegistry,
  $useAnalyzedFlows,
  useStateAdapter,
  useQueueAdapter,
} from '#imports'
import { SYSTEM_HANDLERS } from '../system'

const logger = useNventLogger('node-runner')

/**
 * Generic job interface that works with any queue adapter
 * Adapters should provide jobs in this format
 */
export interface QueueJob {
  id: string
  name: string
  data: any
  attemptsMade?: number
  opts?: {
    attempts?: number
  }
}

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
  flow: ReturnType<typeof useFlow>
  /**
   * Resolved data from await pattern (awaitBefore only)
   * Available when step resumes after await resolution
   */
  trigger?: any
  /**
   * Current step's await configuration
   * Useful for conditional logic based on await settings
   */
  awaitConfig?: any
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
  // Provide a lazy StateAdapter so ctx.state works without explicit wiring at callsites
  const state = partial?.state || ((): RunState => {
    try {
      const stateAdapter = useStateAdapter()
      const rc: any = useRuntimeConfig()
      const cleanupCfg = rc?.nvent?.state?.cleanup || { strategy: 'never' }
      return {
        async get(key) { return stateAdapter.get(scopeKey(key, partial?.flowId)) },
        async set(key, value, opts) {
          const ttl = opts?.ttl ?? (cleanupCfg?.strategy === 'ttl' ? cleanupCfg?.ttlMs : undefined)
          return stateAdapter.set(scopeKey(key, partial?.flowId), value, ttl ? { ttl } : undefined)
        },
        async delete(key) { return stateAdapter.delete(scopeKey(key, partial?.flowId)) },
      }
    }
    catch {
      return defaultState
    }
  })()

  // Logger bridge: use provider; also mirror to events as runner.log
  const logger: RunLogger = partial?.logger || (() => {
    const eventManager = useEventManager()
    return {
      log: (level, msg, meta) => {
        // publish log event directly
        const runId = partial?.flowId || 'unknown'
        const flowName = meta?.flowName || 'unknown'
        void eventManager.publishBus({
          type: 'log',
          runId,
          flowName,
          stepName: meta?.stepName,
          stepId: meta?.stepId || meta?.stepRunId,
          attempt: meta?.attempt,
          data: { level, message: msg, ...meta },
        })
      },
    }
  })()
  // Flow engine for trigger handling - bind to context for automatic flowId/flowName/stepName
  const baseFlowEngine = useFlow()
  const flow = {
    ...baseFlowEngine,
    emit: async (trigger: string, payload: any = {}) => {
      // Auto-inject flowId, flowName, and stepName from context if not provided
      const enrichedPayload = {
        ...payload,
        flowId: payload.flowId || partial?.flowId,
        flowName: payload.flowName || partial?.flowName,
        stepName: payload.stepName || partial?.stepName,
      }
      return baseFlowEngine.emit(trigger, enrichedPayload)
    },
    cancel: async () => {
      // Auto-inject flowId and flowName from context
      if (!partial?.flowName || !partial?.flowId) {
        throw new Error('Cannot cancel flow: flowName or flowId not available in context')
      }
      return baseFlowEngine.cancelFlow(partial.flowName, partial.flowId)
    },
    isRunning: async (flowName?: string, runId?: string) => {
      // Use provided flowName or current context flowName
      const targetFlowName = flowName || partial?.flowName
      if (!targetFlowName) {
        throw new Error('flowName is required to check if flow is running')
      }
      return baseFlowEngine.isRunning(targetFlowName, runId)
    },
    getRunningFlows: async (flowName?: string) => {
      // Use provided flowName or current context flowName
      const targetFlowName = flowName || partial?.flowName
      if (!targetFlowName) {
        throw new Error('flowName is required to get running flows')
      }
      return baseFlowEngine.getRunningFlows(targetFlowName)
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
    trigger: partial?.trigger,
    awaitConfig: partial?.awaitConfig,
  }
}

export type NodeHandler = (input: any, ctx: RunContext) => Promise<any>

/**
 * Wraps a NodeHandler with full RunContext building and event emission
 * Works with any queue adapter by accepting a job-like object
 */
export function createJobProcessor(handler: NodeHandler, queueName: string) {
  return async function processor(job: QueueJob) {
    // Normal job processing
    const eventMgr = useEventManager()
    const rc: any = useRuntimeConfig()
    // Read autoScope from store.state.autoScope
    const autoScope: 'always' | 'flow' | 'never' = rc?.nvent?.store?.state?.autoScope || 'always'
    const providedFlow = job.data?.flowId
    // Always use a proper flow identifier (UUID for new flows, never job ID)
    const flowId = providedFlow || (autoScope === 'always' ? randomUUID() : undefined)

    // Get actual attempt number from BullMQ (1-indexed: attemptsMade starts at 0)
    const attempt = (job.attemptsMade || 0) + 1
    const maxAttempts = job.opts?.attempts || 1
    const isFinalAttempt = attempt >= maxAttempts

    // Generate a unique stepRunId for this attempt
    const stepRunId = `${String(flowId || job.id)}__${job.name}__attempt-${attempt}`
    // Get flowName for v0.4 events
    const flowName = (job.data as any)?.flowName || 'unknown'

    // Load step configuration from registry for await patterns
    const registry = $useFunctionRegistry() as any
    const flowRegistry = (registry?.flows || {})[flowName]

    // Check both steps and entry for the step metadata
    let stepMeta = flowRegistry?.steps?.[job.name]

    // If not found in steps, check if this is the entry step
    if (!stepMeta && flowRegistry?.entry?.step === job.name) {
      stepMeta = flowRegistry?.entry
    }

    const awaitBefore = stepMeta?.awaitBefore
    const awaitAfter = stepMeta?.awaitAfter

    // Check if this is an await resume
    const isAwaitResume = job.data?.awaitResolved === true
    const awaitData = job.data?.awaitData
    const awaitPosition = job.data?.awaitPosition // 'before' or 'after'

    const ctx = buildContext({
      jobId: job.id as string,
      queue: queueName,
      flowId,
      flowName,
      stepName: job.name,
      stepId: stepRunId,
      attempt,
      trigger: isAwaitResume ? awaitData : undefined,
      awaitConfig: awaitBefore || awaitAfter || undefined,
    })

    // Derive a logger that injects stepName/attempt/stepRunId by default during this attempt
    const attemptLogger = {
      log: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: any) => {
        const enriched = { ...(meta || {}), stepName: job.name, attempt, stepRunId, flowName }
        ctx.logger.log(level, msg, enriched)
      },
    }

    // Emit step.started event
    try {
      await eventMgr.publishBus({
        type: 'step.started',
        runId: flowId || 'unknown',
        flowName,
        stepName: job.name,
        stepId: stepRunId,
        attempt,
        data: {
          jobId: job.id,
          name: job.name,
          queue: queueName,
        } as any,
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
      logger.error(`[worker] Job failed: ${job.name} (${job.id})`, {
        queue: queueName,
        flowId,
        flowName,
        stepName: job.name,
        error: (err as any)?.message || String(err),
        stack: (err as any)?.stack,
      })

      // Determine if this is a retry or final failure
      const willRetry = !isFinalAttempt

      // Only emit step.retry for non-final attempts
      // Emit step.failed ONLY on the final attempt (after all retries exhausted)
      if (willRetry) {
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
              attempt,
              maxAttempts,
              nextAttempt: attempt + 1,
              error: String((err as any)?.message || err),
              stack: (err as any)?.stack,
            } as any,
          })
        }
        catch {
          // ignore
        }
      }
      else {
        // Final attempt failed - emit step.failed
        try {
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
    // Emit step.completed event
    try {
      const eventMgr = useEventManager()
      await eventMgr.publishBus({
        type: 'step.completed',
        runId: flowId || 'unknown',
        flowName,
        stepName: job.name,
        stepId: stepRunId,
        attempt,
        data: { result } as any,
      })
    }
    catch {
      // ignore
    }

    // awaitAfter: Register await pattern after step completes
    // This blocks dependent steps from triggering until the await is resolved
    // Skip registration only if resuming from awaitAfter (not awaitBefore)
    const shouldRegisterAwaitAfter = awaitAfter && (!isAwaitResume || awaitPosition === 'before')
    if (shouldRegisterAwaitAfter) {
      try {
        const queue = useQueueAdapter()

        // Enqueue system handler to register await pattern in the same queue
        // System handlers execute user-defined lifecycle hooks, so they need timeout
        // Use the same stepTimeout as the step itself since they're part of the step lifecycle
        const analyzedFlows = $useAnalyzedFlows()
        const flowDef = analyzedFlows.find((f: any) => f.id === flowName) as any
        const analyzedAwaitStep = flowDef?.analyzed?.steps?.[job.name]
        const awaitStepTimeout = analyzedAwaitStep?.stepTimeout

        await queue.enqueue(queueName, {
          name: SYSTEM_HANDLERS.AWAIT_REGISTER,
          data: {
            flowId: flowId || 'unknown',
            flowName,
            stepName: job.name,
            position: 'after' as const,
            awaitConfig: awaitAfter,
            input: { ...job.data, result },
          },
          opts: { jobId: `${flowId}__${job.name}__await-register-after`, timeout: awaitStepTimeout },
        })
      }
      catch (err) {
        logger.error('Failed to register awaitAfter pattern', {
          flowName,
          stepName: job.name,
          error: (err as Error).message,
        })
      }
    }

    return result
  }
}
