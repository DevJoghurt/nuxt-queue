/**
 * Flow Stall Detection System
 *
 * Detects and marks flows that have been in "running" state for too long without activity.
 * Uses a hybrid approach:
 * 1. Lazy detection: Check stall status when flows are queried (zero overhead)
 * 2. Periodic cleanup: Background job that checks all running flows periodically (safety net)
 *
 * A flow is considered "stalled" when:
 * - Status is "running"
 * - No activity (step events) for longer than STALL_TIMEOUT
 * - lastActivityAt timestamp is older than threshold
 */

import type { StoreAdapter } from '../../adapters/interfaces/store'
import { useNventLogger, useStreamTopics, $useAnalyzedFlows } from '#imports'

export interface StallDetectorConfig {
  /**
   * Time in milliseconds after which a running flow without activity is considered stalled
   * @default 1800000 (30 minutes)
   */
  stallTimeout?: number

  /**
   * Interval in milliseconds for periodic stall checks
   * @default 900000 (15 minutes)
   */
  checkInterval?: number

  /**
   * Enable periodic background checks
   * Set to false to use only lazy detection
   * @default true
   */
  enablePeriodicCheck?: boolean
}

export type FlowStatus = 'running' | 'completed' | 'failed' | 'canceled' | 'stalled'

export interface FlowActivity {
  runId: string
  flowName: string
  status: FlowStatus
  startedAt: number
  lastActivityAt: number
  metadata?: any
}

const DEFAULT_STALL_TIMEOUT = 30 * 60 * 1000 // 30 minutes
const DEFAULT_CHECK_INTERVAL = 15 * 60 * 1000 // 15 minutes

export class FlowStallDetector {
  private store: StoreAdapter
  private config: Required<StallDetectorConfig>
  private logger = useNventLogger('stall-detector')
  private intervalId?: NodeJS.Timeout
  private started = false

  constructor(store: StoreAdapter, config: StallDetectorConfig = {}) {
    this.store = store
    this.config = {
      stallTimeout: config.stallTimeout ?? DEFAULT_STALL_TIMEOUT,
      checkInterval: config.checkInterval ?? DEFAULT_CHECK_INTERVAL,
      enablePeriodicCheck: config.enablePeriodicCheck ?? true,
    }
  }

  /**
   * Start the periodic stall detector
   * Should be called once per instance after adapters are initialized
   */
  start(): void {
    if (this.started) {
      this.logger.warn('Stall detector already started')
      return
    }

    this.started = true

    if (this.config.enablePeriodicCheck) {
      this.logger.info('Starting periodic stall detector', {
        stallTimeout: `${this.config.stallTimeout / 1000}s`,
        checkInterval: `${this.config.checkInterval / 1000}s`,
      })

      // Run first check after a short delay to avoid startup overhead
      setTimeout(() => {
        this.checkAllRunningFlows()
      }, 60 * 1000) // First check after 1 minute

      // Then run periodically
      this.intervalId = setInterval(() => {
        this.checkAllRunningFlows()
      }, this.config.checkInterval)
    }
    else {
      this.logger.info('Periodic stall detector disabled, using lazy detection only')
    }
  }

  /**
   * Stop the periodic stall detector
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = undefined
      this.logger.info('Stopped periodic stall detector')
    }
    this.started = false
  }

  /**
   * Get stall timeout for a specific flow
   * Uses flow-specific timeout from analyzed metadata, falls back to global config
   */
  private async getFlowStallTimeout(flowName: string): Promise<number> {
    try {
      const analyzedFlows = $useAnalyzedFlows() as any[]
      const flowMeta = analyzedFlows.find((f: any) => f.id === flowName)

      if (flowMeta?.stallTimeout) {
        this.logger.debug('Using flow-specific stall timeout', {
          flowName,
          timeout: `${flowMeta.stallTimeout / 1000}s`,
        })
        return flowMeta.stallTimeout
      }
    }
    catch (error) {
      this.logger.warn('Failed to get flow-specific stall timeout', {
        flowName,
        error: (error as Error).message,
      })
    }

    // Fall back to global config
    return this.config.stallTimeout
  }

  /**
   * Update activity timestamp for a flow
   * Should be called on every step event (started, completed, failed, retry)
   */
  async updateActivity(flowName: string, runId: string): Promise<void> {
    const { SubjectPatterns } = useStreamTopics()
    const indexKey = SubjectPatterns.flowRunIndex(flowName)

    try {
      // Update lastActivityAt timestamp in index metadata
      if (!this.store.indexUpdate) {
        this.logger.warn('Store does not support indexUpdate, cannot update activity')
        return
      }

      await this.store.indexUpdate(indexKey, runId, {
        lastActivityAt: Date.now(),
      })
    }
    catch (error) {
      this.logger.warn('Failed to update flow activity', {
        flowName,
        runId,
        error: (error as Error).message,
      })
    }
  }

  /**
   * Check if a specific flow is stalled (lazy detection)
   * Returns true if the flow should be marked as stalled
   * v0.5: Await-aware - uses flow-specific timeout and skips awaiting flows
   */
  async isStalled(flowName: string, runId: string): Promise<boolean> {
    const { SubjectPatterns } = useStreamTopics()
    const indexKey = SubjectPatterns.flowRunIndex(flowName)

    try {
      if (!this.store.indexGet) return false

      const flowEntry = await this.store.indexGet(indexKey, runId)
      if (!flowEntry?.metadata) return false

      // Only check running flows
      if (flowEntry.metadata.status !== 'running') return false

      // v0.5: Skip flows with active awaits - they are legitimately paused
      const awaitingSteps = flowEntry.metadata.awaitingSteps || {}
      const hasActiveAwaits = Object.keys(awaitingSteps).length > 0
      if (hasActiveAwaits) {
        this.logger.debug('Flow has active awaits, skipping stall check', {
          flowName,
          runId,
          awaitingSteps: Object.keys(awaitingSteps),
        })
        return false
      }

      // v0.5: Use flow-specific stall timeout
      const stallTimeout = await this.getFlowStallTimeout(flowName)

      // Check activity timestamp
      const lastActivity = flowEntry.metadata.lastActivityAt || flowEntry.metadata.startedAt || 0
      const timeSinceActivity = Date.now() - lastActivity

      if (timeSinceActivity > stallTimeout) {
        this.logger.info('Flow detected as stalled (lazy check)', {
          flowName,
          runId,
          timeSinceActivity: `${Math.round(timeSinceActivity / 1000)}s`,
          stallTimeout: `${stallTimeout / 1000}s`,
        })
        return true
      }

      return false
    }
    catch (error) {
      this.logger.warn('Failed to check if flow is stalled', {
        flowName,
        runId,
        error: (error as Error).message,
      })
      return false
    }
  }

  /**
   * Mark a flow as stalled
   * Emits a flow.stalled event and updates the flow status
   */
  async markAsStalled(flowName: string, runId: string, reason: string = 'No activity timeout'): Promise<void> {
    const { SubjectPatterns } = useStreamTopics()
    const indexKey = SubjectPatterns.flowRunIndex(flowName)

    try {
      // Get current flow metadata
      if (!this.store.indexGet) {
        this.logger.warn('Store does not support indexGet, cannot mark as stalled')
        return
      }

      const flowEntry = await this.store.indexGet(indexKey, runId)
      if (!flowEntry?.metadata) return

      // Only mark running flows as stalled
      if (flowEntry.metadata.status !== 'running') return

      // Update status to stalled using indexUpdate
      if (this.store.indexUpdate) {
        await this.store.indexUpdate(indexKey, runId, {
          status: 'stalled',
          stalledAt: Date.now(),
          stallReason: reason,
        })
      }

      // Emit flow.stalled event
      const streamName = SubjectPatterns.flowRun(runId)
      await this.store.append(streamName, {
        type: 'flow.stalled',
        runId,
        flowName,
        data: {
          reason,
        },
      })

      this.logger.info('Marked flow as stalled', {
        flowName,
        runId,
        reason,
      })
    }
    catch (error) {
      this.logger.error('Failed to mark flow as stalled', {
        flowName,
        runId,
        error: (error as Error).message,
      })
    }
  }

  /**
   * Check all running flows and mark stalled ones
   * This is called by the periodic background job
   *
   * Note: This method requires knowledge of which flows exist.
   * For now, we'll need to pass flow names to check, or iterate known flows from registry.
   */
  async checkFlowsForStalls(flowNames: string[]): Promise<void> {
    this.logger.debug('Running periodic stall check', { flows: flowNames.length })

    try {
      if (!this.store.indexGet || !this.store.indexRead) {
        this.logger.warn('Store does not support required index operations')
        return
      }

      const { SubjectPatterns } = useStreamTopics()
      let checkedCount = 0
      let stalledCount = 0

      // Check each flow
      for (const flowName of flowNames) {
        const indexKey = SubjectPatterns.flowRunIndex(flowName)

        // v0.5: Get flow-specific stall timeout
        const stallTimeout = await this.getFlowStallTimeout(flowName)

        // Get all flow runs from the index
        const entries = await this.store.indexRead(indexKey, { limit: 1000 })

        for (const entry of entries) {
          if (!entry.metadata) continue

          checkedCount++

          // Only check running flows
          if (entry.metadata.status !== 'running') continue

          // v0.5: Skip flows with active awaits
          const awaitingSteps = entry.metadata.awaitingSteps || {}
          if (Object.keys(awaitingSteps).length > 0) {
            continue
          }

          // Check if stalled
          const lastActivity = entry.metadata.lastActivityAt || entry.metadata.startedAt || 0
          const timeSinceActivity = Date.now() - lastActivity

          if (timeSinceActivity > stallTimeout) {
            await this.markAsStalled(flowName, entry.id, 'Periodic check detected no activity')
            stalledCount++
          }
        }
      }

      if (stalledCount > 0) {
        this.logger.info('Periodic stall check completed', {
          checked: checkedCount,
          stalled: stalledCount,
        })
      }
      else {
        this.logger.debug('Periodic stall check completed', {
          checked: checkedCount,
          stalled: 0,
        })
      }
    }
    catch (error) {
      this.logger.error('Failed to run periodic stall check', {
        error: (error as Error).message,
      })
    }
  }

  /**
   * Internal method for periodic checks
   * Gets flow names from registry and checks them
   */
  private async checkAllRunningFlows(): Promise<void> {
    try {
      // Get all flow names from the analyzed flows registry
      const { $useAnalyzedFlows } = await import('#imports')
      const analyzedFlows = $useAnalyzedFlows() as any[]
      const flowNames = analyzedFlows.map((f: any) => f.id).filter(Boolean)

      if (flowNames.length === 0) {
        this.logger.debug('No flows registered, skipping stall check')
        return
      }

      await this.checkFlowsForStalls(flowNames)
    }
    catch (error) {
      this.logger.error('Failed to run periodic stall check', {
        error: (error as Error).message,
      })
    }
  }

  /**
   * Get stall detector statistics
   */
  getStats() {
    return {
      enabled: this.started,
      periodicCheckEnabled: this.config.enablePeriodicCheck,
      stallTimeout: this.config.stallTimeout,
      checkInterval: this.config.checkInterval,
    }
  }
}

/**
 * Create and configure a flow stall detector
 */
export function createStallDetector(
  store: StoreAdapter,
  config?: StallDetectorConfig,
): FlowStallDetector {
  return new FlowStallDetector(store, config)
}
