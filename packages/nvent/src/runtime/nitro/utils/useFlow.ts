import { $useFunctionRegistry, useQueueAdapter, useEventManager, useStoreAdapter, useNventLogger, useStreamTopics } from '#imports'
import { randomUUID } from 'node:crypto'

export interface FlowStats {
  name: string
  displayName?: string
  registeredAt: string
  lastRunAt?: string
  lastCompletedAt?: string
  stats: {
    total: number
    success: number
    failure: number
    cancel: number
    running: number
    awaiting: number
  }
  version?: number
}

/**
 * Flow composable for managing flows and accessing flow statistics
 * Provides methods for starting, canceling, and querying flows
 */
export function useFlow() {
  const registry = $useFunctionRegistry()
  const queueAdapter = useQueueAdapter()
  const eventsManager = useEventManager()
  const store = useStoreAdapter()
  const logger = useNventLogger('use-flow')
  const { StoreSubjects } = useStreamTopics()

  return {
    /**
     * Start a flow with the given payload
     */
    async startFlow(flowName: string, payload: any = {}) {
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

      // Emit flow.start event
      try {
        await eventsManager.publishBus({ type: 'flow.start', runId: flowId, flowName, data: { input: payload } })
      }
      catch { /* best-effort */ }

      return { id, queue: queueName, step: flow.entry.step, flowId }
    },

    /**
     * Emit a trigger event for flow coordination
     */
    async emit(trigger: string, payload: any = {}) {
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
            payload: actualPayload,
          },
        } as any)
      }
      catch (err) {
        logger.error('Failed to emit trigger event', { trigger, error: err })
      }

      return []
    },

    /**
     * Cancel a running flow
     */
    async cancelFlow(flowName: string, runId: string) {
      try {
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
    },

    /**
     * Check if a flow is currently running
     */
    async isRunning(flowName: string, runId?: string) {
      try {
        if (!store.index.read) {
          return false
        }

        const runIndexKey = StoreSubjects.flowRunIndex(flowName)
        const entries = await store.index.read(runIndexKey, { limit: 1000 })

        // If runId is provided, check specific run
        if (runId) {
          const run = entries.find(e => e.id === runId)
          return run?.metadata?.status === 'running'
        }

        // Otherwise, check if ANY run of this flow is running
        return entries.some(e => e.metadata?.status === 'running')
      }
      catch (err) {
        logger.error('Error checking flow status:', err)
        return false
      }
    },

    /**
     * Get all currently running flows
     */
    async getRunningFlows(flowName: string) {
      try {
        if (!store.index.read) {
          return []
        }

        const runIndexKey = StoreSubjects.flowRunIndex(flowName)
        const entries = await store.index.read(runIndexKey, { limit: 1000 })

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
        logger.error('Error getting running flows:', err)
        return []
      }
    },

    /**
     * Get flow statistics by name
     */
    async getFlowStats(flowName: string): Promise<FlowStats | null> {
      try {
        const indexKey = StoreSubjects.flowIndex()

        if (!store.index.get) {
          logger.warn('Store adapter does not support indexGet')
          return null
        }

        const entry = await store.index.get(indexKey, flowName)

        if (!entry) {
          return null
        }

        const metadata = entry.metadata as any

        return {
          name: metadata.name || flowName,
          displayName: metadata.displayName,
          registeredAt: metadata.registeredAt,
          lastRunAt: metadata.lastRunAt,
          lastCompletedAt: metadata.lastCompletedAt,
          stats: {
            total: metadata.stats?.total || 0,
            success: metadata.stats?.success || 0,
            failure: metadata.stats?.failure || 0,
            cancel: metadata.stats?.cancel || 0,
            running: metadata.stats?.running || 0,
            awaiting: metadata.stats?.awaiting || 0,
          },
          version: metadata.version,
        }
      }
      catch (err) {
        logger.error('Error getting flow stats', {
          flowName,
          error: (err as any)?.message,
        })
        return null
      }
    },

    /**
     * Get all flows with their statistics
     */
    async getAllFlowStats(options?: {
      sortBy?: 'registeredAt' | 'lastRunAt' | 'name'
      order?: 'asc' | 'desc'
      limit?: number
      offset?: number
    }): Promise<FlowStats[]> {
      try {
        const indexKey = StoreSubjects.flowIndex()

        if (!store.index.read) {
          logger.warn('Store adapter does not support indexRead')
          return []
        }

        const entries = await store.index.read(indexKey, {
          limit: options?.limit || 1000,
          offset: options?.offset || 0,
        })

        const flows: FlowStats[] = entries.map((entry: any) => {
          const metadata = entry.metadata as any

          return {
            name: metadata.name || entry.id,
            displayName: metadata.displayName,
            registeredAt: metadata.registeredAt,
            lastRunAt: metadata.lastRunAt,
            lastCompletedAt: metadata.lastCompletedAt,
            stats: {
              total: metadata.stats?.total || 0,
              success: metadata.stats?.success || 0,
              failure: metadata.stats?.failure || 0,
              cancel: metadata.stats?.cancel || 0,
              running: metadata.stats?.running || 0,
              awaiting: metadata.stats?.awaiting || 0,
            },
            version: metadata.version,
          }
        })

        // Apply sorting
        if (options?.sortBy) {
          flows.sort((a, b) => {
            let aVal: any
            let bVal: any

            if (options.sortBy === 'name') {
              aVal = a.name
              bVal = b.name
            }
            else if (options.sortBy === 'registeredAt') {
              aVal = new Date(a.registeredAt).getTime()
              bVal = new Date(b.registeredAt).getTime()
            }
            else if (options.sortBy === 'lastRunAt') {
              aVal = a.lastRunAt ? new Date(a.lastRunAt).getTime() : 0
              bVal = b.lastRunAt ? new Date(b.lastRunAt).getTime() : 0
            }

            const order = options.order === 'desc' ? -1 : 1
            return (aVal > bVal ? 1 : aVal < bVal ? -1 : 0) * order
          })
        }

        return flows
      }
      catch (err) {
        logger.error('Error getting all flow stats', {
          error: (err as any)?.message,
        })
        return []
      }
    },

    /**
     * Check if a flow has statistics in the index
     */
    async hasFlowStats(flowName: string): Promise<boolean> {
      const stats = await this.getFlowStats(flowName)
      return stats !== null
    },
  }
}
