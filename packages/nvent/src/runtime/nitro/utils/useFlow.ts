import { useStoreAdapter, useNventLogger, useStreamTopics } from '#imports'

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
  }
  version?: number
}

/**
 * Flow composable for accessing flow statistics and metadata
 * Reads from the flow index (similar to trigger index)
 */
export function useFlow() {
  const store = useStoreAdapter()
  const logger = useNventLogger('use-flow')
  const { StoreSubjects } = useStreamTopics()

  return {
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
