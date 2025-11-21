import { $useFunctionRegistry, useQueueAdapter, useEventManager, useNventLogger, useStoreAdapter, useStreamTopics } from '#imports'
import { randomUUID } from 'node:crypto'

/**
 * Flow Engine for starting and emitting flow events
 */
export const useFlowEngine = () => {
  const registry = $useFunctionRegistry()
  const queueAdapter = useQueueAdapter()
  const eventsManager = useEventManager()
  const logger = useNventLogger('flow-engine')

  const startFlow = async (flowName: string, payload: any = {}) => {
    const flow = (registry?.flows as Record<string, any>)?.[flowName]
    if (!flow || !flow.entry) throw new Error('Flow not found')

    // Extract queue name (handle both string and object formats)
    const queueName = typeof flow.entry.queue === 'string'
      ? flow.entry.queue
      : flow.entry.queue?.name || flow.entry.queue

    // Get default job options from registry worker config (includes attempts config)
    // Find the entry worker for this flow to get its queue.defaultJobOptions
    const entryWorker = (registry?.workers as any[])?.find((w: any) =>
      w?.flow?.step === flow.entry.step && w?.queue?.name === queueName,
    )
    const opts = entryWorker?.queue?.defaultJobOptions || {}

    // Generate a flowId for the entire run
    const flowId = randomUUID()
    const id = await queueAdapter.enqueue(queueName, { name: flow.entry.step, data: { ...payload, flowId, flowName }, opts })
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
    const stepName = payload?.stepName

    if (!flowId) {
      logger.warn('emit called without flowId, trigger may not work', { trigger })
    }

    // Extract flowId/flowName/stepName from payload and store the rest as the actual emit data
    const { flowId: _, flowName: __, stepName: ___, ...actualPayload } = payload

    try {
      await eventsManager.publishBus({
        type: 'emit',
        runId: flowId || 'unknown',
        flowName,
        stepName,
        data: {
          name: trigger,
          payload: actualPayload, // Store actual payload separately
        },
      } as any)
    }
    catch (err) {
      logger.error('Failed to emit trigger event', { trigger, error: err })
    }

    // Return empty array since actual enqueueing happens in flows plugin
    return []
  }

  const cancelFlow = async (flowName: string, runId: string) => {
    try {
      // Emit flow.cancel event to mark the flow as canceled
      await eventsManager.publishBus({
        type: 'flow.cancel',
        runId,
        flowName,
        data: {
          canceledAt: new Date().toISOString(),
        },
      })

      logger.info('Flow canceled', { flowName, runId })
      return { success: true, runId, flowName }
    }
    catch (err) {
      logger.error('Failed to cancel flow', { flowName, runId, error: err })
      throw err
    }
  }

  const isRunning = async (flowName: string, runId?: string) => {
    try {
      const store = useStoreAdapter()
      const { SubjectPatterns } = useStreamTopics()

      // Check if indexRead is available
      if (!store.indexRead) {
        return false
      }

      // If runId is provided, check specific run
      if (runId) {
        const runIndexKey = SubjectPatterns.flowRunIndex(flowName)
        const entries = await store.indexRead(runIndexKey, { limit: 1000 })
        const run = entries.find(e => e.id === runId)
        return run?.metadata?.status === 'running'
      }

      // Otherwise, check if ANY run of this flow is running
      const runIndexKey = SubjectPatterns.flowRunIndex(flowName)
      const entries = await store.indexRead(runIndexKey, { limit: 1000 })
      return entries.some(e => e.metadata?.status === 'running')
    }
    catch (err) {
      logger.error('[isRunning] Error checking flow status:', err)
      return false
    }
  }

  const getRunningFlows = async (flowName: string) => {
    try {
      const store = useStoreAdapter()
      const { SubjectPatterns } = useStreamTopics()

      // Check if indexRead is available
      if (!store.indexRead) {
        return []
      }

      const runIndexKey = SubjectPatterns.flowRunIndex(flowName)
      const entries = await store.indexRead(runIndexKey, { limit: 1000 })

      return entries
        .filter(e => e.metadata?.status === 'running')
        .map(e => ({
          id: e.id,
          flowName,
          status: e.metadata?.status,
          startedAt: e.metadata?.startedAt,
          stepCount: e.metadata?.stepCount || 0,
          completedSteps: e.metadata?.completedSteps || 0,
        }))
    }
    catch (err) {
      logger.error('[getRunningFlows] Error getting running flows:', err)
      return []
    }
  }

  return { startFlow, emit, cancelFlow, isRunning, getRunningFlows }
}
