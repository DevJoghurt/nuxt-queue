import type { RunContext, RunLogger, RunState } from '../worker/node/runner'
import { useEventManager, useFlowEngine, useRuntimeConfig, useStateAdapter } from '#imports'

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

/**
 * Create a minimal RunContext for use in lifecycle hooks and event handlers
 * This is a lightweight version without the full worker context
 */
export function useRunContext(partial?: Partial<RunContext>): RunContext {
  // Provide a lazy StateAdapter so ctx.state works
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

  // Logger bridge: publish to event bus
  const logger: RunLogger = partial?.logger || (() => {
    const eventManager = useEventManager()
    return {
      log: (level, msg, meta) => {
        const runId = partial?.flowId || 'unknown'
        const flowName = meta?.flowName || partial?.flowName || 'unknown'
        void eventManager.publishBus({
          type: 'log',
          runId,
          flowName,
          stepName: meta?.stepName || partial?.stepName,
          stepId: meta?.stepId,
          attempt: meta?.attempt,
          data: { level, message: msg, ...meta },
        })
      },
    }
  })()

  // Flow engine with context binding
  const baseFlowEngine = useFlowEngine()
  const flow = {
    ...baseFlowEngine,
    emit: async (trigger: string, payload: any = {}) => {
      const enrichedPayload = {
        ...payload,
        flowId: payload.flowId || partial?.flowId,
        flowName: payload.flowName || partial?.flowName,
      }
      return baseFlowEngine.emit(trigger, enrichedPayload)
    },
    cancel: async () => {
      if (!partial?.flowName || !partial?.flowId) {
        throw new Error('Cannot cancel flow: flowName or flowId not available in context')
      }
      return baseFlowEngine.cancelFlow(partial.flowName, partial.flowId)
    },
    isRunning: async (flowName?: string, runId?: string) => {
      const targetFlowName = flowName || partial?.flowName
      if (!targetFlowName) {
        throw new Error('flowName is required to check if flow is running')
      }
      return baseFlowEngine.isRunning(targetFlowName, runId)
    },
    getRunningFlows: async (flowName?: string) => {
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
