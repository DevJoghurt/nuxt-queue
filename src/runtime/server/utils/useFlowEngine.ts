import { $useQueueRegistry, useQueue, useEventManager } from '#imports'
import { randomUUID } from 'node:crypto'

export const useFlowEngine = () => {
  const registry = $useQueueRegistry()
  const queueAdapter = useQueue()
  const eventsManager = useEventManager()

  const startFlow = async (flowName: string, payload: any = {}) => {
    const flow = (registry?.flows as Record<string, any>)?.[flowName]
    if (!flow || !flow.entry) throw new Error('Flow not found')

    // Extract queue name (handle both string and object formats)
    const queueName = typeof flow.entry.queue === 'string'
      ? flow.entry.queue
      : flow.entry.queue?.name || flow.entry.queue

    // Generate a flowId for the entire run
    const flowId = randomUUID()
    const id = await queueAdapter.enqueue(queueName, { name: flow.entry.step, data: { ...payload, flowId, flowName } })
    // v0.4: Emit flow.start event
    try {
      await eventsManager.publishBus({ type: 'flow.start', runId: flowId, flowName, data: { input: payload } })
    }
    catch { /* best-effort */ }
    return { id, queue: queueName, step: flow.entry.step, flowId }
  }

  const emit = async (trigger: string, payload: any = {}) => {
    // v0.4: Emit an 'emit' event that the flows plugin will handle
    // This allows the flows plugin to manage enqueueing and idempotency
    const flowId = payload?.flowId
    const flowName = payload?.flowName || 'unknown'

    if (!flowId) {
      console.warn('[useFlowEngine] emit called without flowId, trigger may not work:', trigger)
    }

    // Extract flowId/flowName from payload and store the rest as the actual emit data
    const { flowId: _, flowName: __, ...actualPayload } = payload

    try {
      await eventsManager.publishBus({
        type: 'emit',
        runId: flowId || 'unknown',
        flowName,
        data: {
          name: trigger,
          payload: actualPayload, // Store actual payload separately
        },
      } as any)
    }
    catch (err) {
      console.error('[useFlowEngine] failed to emit trigger event:', err)
    }

    // Return empty array since actual enqueueing happens in flows plugin
    return []
  }

  return { startFlow, emit }
}
