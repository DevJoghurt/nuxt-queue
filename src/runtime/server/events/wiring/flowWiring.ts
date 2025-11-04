import type { StreamAdapter } from '../types'
import type { EventRecord } from '../../../types'
import { getEventBus } from '../eventBus'
import { useStreamStore } from '#imports'

export interface FlowWiringDeps {
  adapter: StreamAdapter
}

/**
 * v0.4 Lean Flow Wiring
 *
 * 1. Persists flow events to streams using runId
 * 2. Maintains a sorted set index using projection names for listing runs
 *
 * Events arrive as "ingress" (no id/ts) and are persisted to `nq:flow:{runId}` streams.
 */
export function createFlowWiring(deps: FlowWiringDeps) {
  const { adapter } = deps
  const bus = getEventBus()
  const unsubs: Array<() => void> = []
  let wired = false

  /**
   * Add flow run to sorted set index for listing
   */
  const indexFlowRun = async (flowName: string, flowId: string, timestamp: number) => {
    try {
      const store = useStreamStore()
      const names = store.names()
      // Use centralized naming function
      const indexKey = names.flowIndex(flowName)

      await store.indexAdd(indexKey, flowId, timestamp)

      if (process.env.NQ_DEBUG_EVENTS === '1') {
        console.log('[flow-wiring] indexed run', { flowName, flowId, indexKey, timestamp })
      }
    }
    catch (err) {
      console.error('[flow-wiring] failed to index run:', err)
    }
  }

  function start() {
    if (wired) return
    wired = true

    // Get stream names utility
    const store = useStreamStore()
    const names = store.names()

    // Subscribe to internal bus with a wildcard-like approach using subscribeRunId
    // Listen to all events from any runId
    const handleFlowEvent = async (e: EventRecord) => {
      try {
        // Only process ingress events (not already persisted)
        if (e.id && e.ts) {
          return
        }

        // v0.4: Get runId and flowName from event
        const runId = e.runId
        if (!runId) {
          return
        }

        const flowName = e.flowName
        if (!flowName) {
          return
        }

        // Use centralized naming function
        const streamName = names.flow(runId)
        const eventData: any = {
          type: e.type,
          runId: e.runId,
          flowName: e.flowName,
          data: e.data,
        }

        // Add step-specific fields if present
        if ('stepName' in e && (e as any).stepName) eventData.stepName = (e as any).stepName
        if ('stepId' in e && (e as any).stepId) eventData.stepId = (e as any).stepId
        if ('attempt' in e && (e as any).attempt) eventData.attempt = (e as any).attempt

        const rec = await adapter.append(streamName, eventData)

        // For flow.start, add to index
        if (e.type === 'flow.start') {
          const timestamp = new Date(rec.ts || Date.now()).getTime()
          await indexFlowRun(flowName, runId, timestamp)
        }
      }
      catch (err) {
        console.error('[flowWiring] ERROR handling event:', {
          type: e.type,
          runId: e.runId,
          flowName: e.flowName,
          error: (err as any)?.message,
          stack: (err as any)?.stack,
        })
      }
    }

    // v0.4: Subscribe to event types
    const eventTypes = [
      'flow.start', 'flow.completed', 'flow.failed',
      'step.started', 'step.completed', 'step.failed', 'step.retry',
      'log', 'emit', 'state',
    ]
    for (const type of eventTypes) {
      unsubs.push(bus.onType(type, handleFlowEvent))
    }

    if (process.env.NQ_DEBUG_EVENTS === '1') {
      console.log('[flow-wiring] started, persisting flow events')
    }
  }

  function stop() {
    for (const u of unsubs.splice(0)) {
      try {
        u()
      }
      catch {
        // ignore
      }
    }

    wired = false

    if (process.env.NQ_DEBUG_EVENTS === '1') {
      console.log('[flow-wiring] stopped')
    }
  }

  return { start, stop }
}
