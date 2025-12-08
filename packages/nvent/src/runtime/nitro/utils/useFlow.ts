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

export interface StartFlowResult {
  id: string
  queue: string
  step: string
  flowId: string
}

export interface CancelFlowResult {
  success: boolean
  runId: string
  flowName: string
}

export interface RestartFlowResult {
  success: boolean
  oldRunId: string
  newRunId: string
  flowName: string
}

export interface RunningFlow {
  id: string
  flowName: string
  status: string
  startedAt: string | undefined
  stepCount: number
  completedSteps: number
}

export interface FlowComposable {
  startFlow: (flowName: string, payload?: any) => Promise<StartFlowResult>
  emit: (trigger: string, payload?: any) => Promise<any[]>
  cancelFlow: (flowName: string, runId: string) => Promise<CancelFlowResult>
  restartFlow: (flowName: string, runId: string) => Promise<RestartFlowResult>
  isRunning: (flowName: string, runId?: string, options?: { excludeRunIds?: string[] }) => Promise<boolean>
  getRunningFlows: (flowName: string, options?: { excludeRunIds?: string[] }) => Promise<RunningFlow[]>
  getFlowStats: (flowName: string) => Promise<FlowStats | null>
  getAllFlowStats: (options?: {
    sortBy?: 'registeredAt' | 'lastRunAt' | 'name'
    order?: 'asc' | 'desc'
    limit?: number
    offset?: number
  }) => Promise<FlowStats[]>
  hasFlowStats: (flowName: string) => Promise<boolean>
}

/**
 * Flow composable for managing flows and accessing flow statistics
 * Provides methods for starting, canceling, and querying flows
 */
export function useFlow(): FlowComposable {
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
      const id = await queueAdapter.enqueue(queueName, {
        name: flow.entry.step,
        data: { ...payload, flowId, flowName },
        opts,
      })

      // Emit flow.start event
      try {
        await eventsManager.publishBus({
          type: 'flow.start',
          runId: flowId,
          flowName,
          data: {
            input: payload,
          },
        })
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
        // Look up current status to include in cancel event for correct stats handling
        let previousStatus: string | undefined
        try {
          const runIndexKey = StoreSubjects.flowRunIndex(flowName)
          const entry = await store.index.get(runIndexKey, runId)
          previousStatus = entry?.metadata?.status
        }
        catch {
          // Best effort - if we can't get status, stats may be slightly off
        }

        await eventsManager.publishBus({
          type: 'flow.cancel',
          runId,
          flowName,
          data: {
            canceledAt: new Date().toISOString(),
            previousStatus, // Include for correct stats counter decrement
          },
        })

        logger.info('Flow canceled', { flowName, runId, previousStatus })
        return { success: true, runId, flowName }
      }
      catch (err) {
        logger.error('Failed to cancel flow', { flowName, runId, error: err })
        throw err
      }
    },

    /**
     * Restart a flow by canceling the current run and starting a new one with the same input
     * @param flowName - The name of the flow
     * @param runId - The run ID to restart
     */
    async restartFlow(flowName: string, runId: string): Promise<RestartFlowResult> {
      try {
        // 1. Get the original input from the flow.start event
        const streamName = StoreSubjects.flowRun(runId)
        const events = await store.stream.read(streamName)

        // Find the flow.start event to get the original input
        const startEvent = events.find((e: any) => e.type === 'flow.start' || e.type === 'flow.started')
        const originalInput = startEvent?.data?.input || {}

        logger.debug('Found original input for restart', { flowName, runId, hasInput: !!startEvent })

        // 2. Cancel the current run (if still active)
        const runIndexKey = StoreSubjects.flowRunIndex(flowName)
        const entry = await store.index.get(runIndexKey, runId)
        const currentStatus = entry?.metadata?.status

        // Only cancel if flow is still active
        if (currentStatus === 'running' || currentStatus === 'awaiting') {
          await eventsManager.publishBus({
            type: 'flow.cancel',
            runId,
            flowName,
            data: {
              canceledAt: new Date().toISOString(),
              previousStatus: currentStatus,
              reason: 'Restarted',
            },
          })
          logger.info('Canceled flow for restart', { flowName, runId, previousStatus: currentStatus })
        }

        // 3. Start a new flow with the same input
        const newResult = await this.startFlow(flowName, originalInput)

        logger.info('Flow restarted', {
          flowName,
          oldRunId: runId,
          newRunId: newResult.flowId,
        })

        return {
          success: true,
          oldRunId: runId,
          newRunId: newResult.flowId,
          flowName,
        }
      }
      catch (err) {
        logger.error('Failed to restart flow', { flowName, runId, error: err })
        throw err
      }
    },

    /**
     * Check if a flow is currently running (includes 'running' and 'awaiting' status)
     * @param flowName - The name of the flow to check
     * @param runId - Optional specific run ID to check (if provided, only checks that run)
     * @param options - Optional configuration
     * @param options.excludeRunIds - Exclude these run IDs from the check (useful when called from within a flow)
     */
    async isRunning(flowName: string, runId?: string, options?: { excludeRunIds?: string[] }) {
      try {
        if (!store.index.read) {
          return false
        }

        const runIndexKey = StoreSubjects.flowRunIndex(flowName)
        const activeStatuses = ['running', 'awaiting']

        // If runId is provided, check specific run via index.get (more efficient)
        if (runId) {
          const run = await store.index.get(runIndexKey, runId)
          return activeStatuses.includes(run?.metadata?.status)
        }

        // Use filter to only fetch active runs (efficient for Postgres, reasonable for Redis/memory)
        const entries = await store.index.read(runIndexKey, {
          limit: 1000,
          filter: { status: activeStatuses },
        })

        const excludeSet = new Set(options?.excludeRunIds || [])

        // Filter out excluded runs
        const matchingRuns = entries.filter(e => !excludeSet.has(e.id))

        return matchingRuns.length > 0
      }
      catch (err) {
        logger.error('Error checking flow status:', err)
        return false
      }
    },

    /**
     * Get all currently running flows (includes 'running' and 'awaiting' status)
     * @param flowName - The name of the flow to check
     * @param options - Optional configuration
     * @param options.excludeRunIds - Exclude these run IDs from the results (useful when called from within a flow)
     */
    async getRunningFlows(flowName: string, options?: { excludeRunIds?: string[] }) {
      try {
        if (!store.index.read) {
          return []
        }

        const runIndexKey = StoreSubjects.flowRunIndex(flowName)
        const activeStatuses = ['running', 'awaiting']

        // Use filter to only fetch active runs
        const entries = await store.index.read(runIndexKey, {
          limit: 1000,
          filter: { status: activeStatuses },
        })

        const excludeSet = new Set(options?.excludeRunIds || [])

        // Filter out excluded runs
        const filteredEntries = entries.filter(e => !excludeSet.has(e.id))

        return filteredEntries.map(e => ({
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
