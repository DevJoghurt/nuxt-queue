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
import { useNventLogger, useStreamTopics, $useAnalyzedFlows, useScheduler } from '#imports'

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
  private schedulerJobId?: string
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
   * Runs startup recovery to clean up flows from previous server instances
   */
  async start(): Promise<void> {
    if (this.started) {
      this.logger.warn('Stall detector already started')
      return
    }

    this.started = true

    // Run startup recovery first to handle flows left running from previous instance
    await this.runStartupRecovery()

    this.logger.info(`Stall detector started - periodicCheck: ${this.config.enablePeriodicCheck}, stallTimeout: ${this.config.stallTimeout / 1000}s, checkInterval: ${this.config.checkInterval / 1000}s`)
  }

  /**
   * Get the configuration for scheduling
   * Returns config needed by flowWiring to register the scheduler job
   */
  getScheduleConfig() {
    return {
      enabled: this.config.enablePeriodicCheck,
      interval: this.config.checkInterval,
      stallTimeout: this.config.stallTimeout,
    }
  }

  /**
   * Set the scheduler job ID (called from flowWiring after scheduling)
   */
  setSchedulerJobId(jobId: string) {
    this.schedulerJobId = jobId
  }

  /**
   * Stop the periodic stall detector
   */
  async stop(): Promise<void> {
    if (this.schedulerJobId) {
      try {
        const scheduler = useScheduler()
        await scheduler.unschedule(this.schedulerJobId)
        this.schedulerJobId = undefined
        this.logger.info('Stopped periodic stall detector')
      }
      catch (error) {
        this.logger.error(`Failed to stop stall detector: ${(error as Error).message}`)
      }
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
        this.logger.debug(`Using flow-specific stall timeout for '${flowName}': ${flowMeta.stallTimeout / 1000}s`)
        return flowMeta.stallTimeout
      }
    }
    catch (error) {
      this.logger.warn(`Failed to get flow-specific stall timeout for '${flowName}': ${(error as Error).message}`)
    }

    // Fall back to global config
    return this.config.stallTimeout
  }

  /**
   * Update activity timestamp for a flow
   * Should be called on every step event (started, completed, failed, retry)
   */
  async updateActivity(flowName: string, runId: string): Promise<void> {
    const { StoreSubjects } = useStreamTopics()
    const indexKey = StoreSubjects.flowRunIndex(flowName)

    try {
      // Update lastActivityAt timestamp in index metadata
      if (!this.store.index.update) {
        this.logger.warn('Store does not support indexUpdate, cannot update activity')
        return
      }

      await this.store.index.update(indexKey, runId, {
        lastActivityAt: Date.now(),
      })
    }
    catch (error) {
      this.logger.warn(`Failed to update flow activity for '${flowName}' runId '${runId}': ${(error as Error).message}`)
    }
  }

  /**
   * Check if a specific flow is stalled (lazy detection)
   * Returns true if the flow should be marked as stalled
   * v0.5: Await-aware - uses flow-specific timeout and skips awaiting flows
   */
  async isStalled(flowName: string, runId: string): Promise<boolean> {
    const { StoreSubjects } = useStreamTopics()
    const indexKey = StoreSubjects.flowRunIndex(flowName)

    try {
      if (!this.store.index.get) return false

      const flowEntry = await this.store.index.get(indexKey, runId)
      if (!flowEntry?.metadata) return false

      // Only check running flows
      if (flowEntry.metadata.status !== 'running') return false

      // v0.5: Skip flows with active awaits - they are legitimately paused
      const awaitingSteps = flowEntry.metadata.awaitingSteps || {}
      const hasActiveAwaits = Object.keys(awaitingSteps).length > 0
      if (hasActiveAwaits) {
        this.logger.debug(`Flow '${flowName}' runId '${runId}' has active awaits [${Object.keys(awaitingSteps).join(', ')}], skipping stall check`)
        return false
      }

      // v0.5: Use flow-specific stall timeout
      const stallTimeout = await this.getFlowStallTimeout(flowName)

      // Check activity timestamp
      const lastActivity = flowEntry.metadata.lastActivityAt || flowEntry.metadata.startedAt || 0
      const timeSinceActivity = Date.now() - lastActivity

      if (timeSinceActivity > stallTimeout) {
        this.logger.info(`Flow detected as stalled (lazy check) - '${flowName}' runId '${runId}': ${Math.round(timeSinceActivity / 1000)}s since activity (timeout: ${stallTimeout / 1000}s)`)
        return true
      }

      return false
    }
    catch (error) {
      this.logger.warn(`Failed to check if flow is stalled for '${flowName}' runId '${runId}': ${(error as Error).message}`)
      return false
    }
  }

  /**
   * Mark a flow as stalled
   * Emits a flow.stalled event and updates the flow status
   */
  async markAsStalled(flowName: string, runId: string, reason: string = 'No activity timeout'): Promise<void> {
    const { StoreSubjects } = useStreamTopics()
    const indexKey = StoreSubjects.flowRunIndex(flowName)

    try {
      // Get current flow metadata
      if (!this.store.index.get) {
        this.logger.warn('Store does not support indexGet, cannot mark as stalled')
        return
      }

      const flowEntry = await this.store.index.get(indexKey, runId)
      if (!flowEntry?.metadata) return

      const previousStatus = flowEntry.metadata.status

      // Only mark running or awaiting flows as stalled
      if (previousStatus !== 'running' && previousStatus !== 'awaiting') return

      // Update status to stalled using indexUpdate
      if (this.store.index.update) {
        await this.store.index.update(indexKey, runId, {
          status: 'stalled',
          previousStatus, // Track what state it was in before stalling
          stalledAt: Date.now(),
          stallReason: reason,
        })
      }

      // Emit flow.stalled event with previous status for stats tracking
      const streamName = StoreSubjects.flowRun(runId)
      await this.store.stream.append(streamName, {
        type: 'flow.stalled',
        runId,
        flowName,
        data: {
          reason,
          previousStatus, // Include previous status so stats handler knows which counter to decrement
        },
      })

      this.logger.info(`Marked flow as stalled - '${flowName}' runId '${runId}': ${reason}`)
    }
    catch (error) {
      this.logger.error(`Failed to mark flow as stalled for '${flowName}' runId '${runId}': ${(error as Error).message}`)
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
    this.logger.info(`Running periodic stall check for ${flowNames.length} flows`)

    try {
      if (!this.store.index.get || !this.store.index.read) {
        this.logger.warn('Store does not support required index operations')
        return
      }

      const { StoreSubjects } = useStreamTopics()
      let checkedCount = 0
      let stalledCount = 0

      // Check each flow
      for (const flowName of flowNames) {
        const indexKey = StoreSubjects.flowRunIndex(flowName)

        // v0.5: Get flow-specific stall timeout (pre-calculated during analysis)
        const flowStallTimeout = await this.getFlowStallTimeout(flowName)

        // Get all flow runs from the index
        const entries = await this.store.index.read(indexKey, { limit: 1000 })

        for (const entry of entries) {
          if (!entry.metadata) continue

          checkedCount++

          // Only check running or awaiting flows
          if (entry.metadata.status !== 'running' && entry.metadata.status !== 'awaiting') continue

          // Check if flow has active awaits - mark as stalled if any have expired
          const awaitingSteps = entry.metadata.awaitingSteps || {}
          const awaitingStepNames = Object.keys(awaitingSteps)

          if (awaitingStepNames.length > 0) {
            let hasOverdueAwaits = false
            let hasLegacyAwait = false

            for (const stepName of awaitingStepNames) {
              const awaitState = awaitingSteps[stepName]

              if (awaitState?.status === 'awaiting') {
                if (!awaitState.timeoutAt) {
                  // Legacy await without timeout - treat as valid
                  hasLegacyAwait = true
                }
                else if (Date.now() > awaitState.timeoutAt) {
                  // Check if this await has timed out
                  hasOverdueAwaits = true
                  break
                }
              }
            }

            if (hasOverdueAwaits) {
              // At least one await has timed out - mark as stalled
              await this.markAsStalled(flowName, entry.id, 'Await pattern timed out')
              stalledCount++
              continue
            }

            // All awaits are valid (or legacy) - skip this flow (legitimately waiting)
            if (hasLegacyAwait) {
              this.logger.debug(`Skipping flow with legacy await (no timeout) - '${flowName}' runId '${entry.id}'`)
            }
            continue
          }

          // No active awaits - check normal stall timeout using flow-specific timeout
          const lastActivity = entry.metadata.lastActivityAt || entry.metadata.startedAt || 0
          const timeSinceActivity = Date.now() - lastActivity

          if (timeSinceActivity > flowStallTimeout) {
            await this.markAsStalled(flowName, entry.id, 'Periodic check detected no activity')
            stalledCount++
          }
        }
      }

      this.logger.info(`Periodic stall check completed - checked: ${checkedCount}, stalled: ${stalledCount}`)
    }
    catch (error) {
      this.logger.error('Failed to run periodic stall check', {
        error: (error as Error).message,
      })
    }
  }

  /**
   * Run startup recovery to clean up flows left in running state from previous server instance
   * This marks all running flows as stalled since their in-memory state is lost
   * Also validates and cleans up flow stats index
   */
  private async runStartupRecovery(): Promise<void> {
    this.logger.info('Running startup recovery to check for orphaned flows and validate stats')

    try {
      if (!this.store.index.get || !this.store.index.read) {
        this.logger.warn('Store does not support required index operations')
        return
      }

      const analyzedFlows = $useAnalyzedFlows() as any[]
      const flowNames = analyzedFlows.map((f: any) => f.id).filter(Boolean)

      this.logger.info(`Starting flow recovery check for ${flowNames.length} registered flows: [${flowNames.join(', ')}]`)

      if (flowNames.length === 0) {
        this.logger.debug('No flows registered, skipping startup recovery')
        return
      }

      const { StoreSubjects } = useStreamTopics()
      let recoveredCount = 0

      // Track actual running/awaiting counts per flow for stats validation
      const actualCounts: Record<string, { running: number, awaiting: number }> = {}

      // 1. Check for orphaned running flows
      for (const flowName of flowNames) {
        actualCounts[flowName] = { running: 0, awaiting: 0 }
        const indexKey = StoreSubjects.flowRunIndex(flowName)

        this.logger.debug(`Reading flow run index for '${flowName}': ${indexKey}`)

        const entries: any[] = await this.store.index.read(indexKey, { limit: 1000 })

        // Count statuses for summary and track running/awaiting for stats validation
        const statusCounts: Record<string, number> = {}

        for (const entry of entries) {
          if (!entry.metadata) {
            this.logger.debug(`Skipping entry without metadata - '${flowName}' runId '${entry.id}'`)
            continue
          }

          const status = entry.metadata.status || 'unknown'
          statusCounts[status] = (statusCounts[status] || 0) + 1

          // Track actual running/awaiting counts for stats validation
          if (status === 'running') {
            actualCounts[flowName].running++
          }
          else if (status === 'awaiting') {
            actualCounts[flowName].awaiting++
          }

          // Check for flows in running or awaiting state
          if (entry.metadata.status === 'running' || entry.metadata.status === 'awaiting') {
            const awaitingSteps = entry.metadata.awaitingSteps || {}
            const awaitingStepNames = Object.keys(awaitingSteps)
            this.logger.info(`Found flow in ${entry.metadata.status} state - '${flowName}' runId '${entry.id}' with ${awaitingStepNames.length} awaiting steps`)
            this.logger.debug(`Flow '${flowName}' runId '${entry.id}' status: ${entry.metadata.status}, awaitingSteps: ${awaitingStepNames.length}`)

            // If flow has awaitingSteps, check if they should have already resolved
            if (awaitingStepNames.length > 0) {
              let hasActiveValidAwaits = false
              let hasOverdueAwaits = false

              // Check each await's status and timing
              for (const stepName of awaitingStepNames) {
                const awaitState = awaitingSteps[stepName]

                this.logger.info(`Checking await state for '${flowName}' runId '${entry.id}' step '${stepName}': status=${awaitState?.status}, timeoutAt=${awaitState?.timeoutAt}, resolveAt=${awaitState?.resolveAt}`)

                if (awaitState?.status === 'awaiting') {
                  // Check if await is overdue (should have resolved by now)
                  const timeoutAt = awaitState.timeoutAt || awaitState.resolveAt

                  if (!timeoutAt) {
                    // Legacy data without timeout - treat as valid but unknown
                    // This is safer than marking as stalled
                    hasActiveValidAwaits = true
                    this.logger.warn(`Found await without timeout (legacy data) - '${flowName}' runId '${entry.id}' step '${stepName}' - treating as valid (timeout tracking was added later)`)
                  }
                  else if (Date.now() > timeoutAt) {
                    // Await is overdue - the scheduler job likely failed or wasn't recovered properly
                    hasOverdueAwaits = true
                    this.logger.warn(`Found overdue await pattern - '${flowName}' runId '${entry.id}' step '${stepName}': timeoutAt=${new Date(timeoutAt).toISOString()}, overdueBy=${Math.round((Date.now() - timeoutAt) / 1000)}s`)
                  }
                  else {
                    // Await is still valid and waiting
                    hasActiveValidAwaits = true
                    this.logger.debug(`Found active valid await - '${flowName}' runId '${entry.id}' step '${stepName}': remaining=${Math.round((timeoutAt - Date.now()) / 1000)}s`)
                  }
                }
              }

              if (hasOverdueAwaits) {
                // Await patterns are overdue - mark flow as stalled since await resolution failed
                this.logger.info(`Marking flow as stalled (overdue awaits) - '${flowName}' runId '${entry.id}'`)
                await this.markAsStalled(flowName, entry.id, 'Await pattern resolution failed or expired')
                recoveredCount++
                continue
              }

              if (hasActiveValidAwaits) {
                // Flow has valid active awaits
                if (entry.metadata.status === 'running') {
                  // Update status to 'awaiting' to reflect correct state
                  if (this.store.index.update) {
                    await this.store.index.update(indexKey, entry.id, {
                      status: 'awaiting',
                    })
                    this.logger.info(`Updated flow status to awaiting (has active awaits) - '${flowName}' runId '${entry.id}' steps: [${awaitingStepNames.join(', ')}]`)
                  }
                }
                else {
                  // Already has status 'awaiting', which is correct
                  this.logger.debug(`Flow already has awaiting status - '${flowName}' runId '${entry.id}'`)
                }
                continue
              }
            }

            // No active awaits - mark as stalled
            this.logger.info(`Marking flow as stalled (no active awaits) - '${flowName}' runId '${entry.id}'`)
            await this.markAsStalled(flowName, entry.id, 'Server restart - flow state lost')
            recoveredCount++
          }
        }

        // Log status summary for this flow
        const statusSummary = Object.entries(statusCounts).map(([status, count]) => `${status}:${count}`).join(', ')
        this.logger.info(`Flow recovery summary for '${flowName}' - total: ${entries.length}, statuses: {${statusSummary}}`)
      }

      // 2. Validate and clean up flow stats index (with actual counts)
      await this.validateFlowStats(flowNames, actualCounts)

      if (recoveredCount > 0) {
        this.logger.info(`Startup recovery completed - marked ${recoveredCount} orphaned flow(s) as stalled`)
      }
      else {
        this.logger.debug('Startup recovery completed - no orphaned flows found')
      }
    }
    catch (error) {
      this.logger.error(`Failed to run startup recovery: ${(error as Error).message}`)
    }
  }

  /**
   * Validate flow stats index and remove entries for non-existent flows
   * Also corrects running/awaiting counts based on actual scanned data
   *
   * NOTE: We only validate running/awaiting counts because:
   * - They are small snapshot values (usually < 100)
   * - We already scanned all flows during startup recovery
   * - Discrepancies indicate actual bugs (flows stuck in wrong state)
   *
   * We do NOT validate total/success/failure/cancel because:
   * - These are cumulative counters that can be millions in production
   * - Validation would require full table scan (prohibitively expensive)
   * - Minor discrepancies don't affect runtime behavior
   */
  private async validateFlowStats(
    validFlowNames: string[],
    actualCounts: Record<string, { running: number, awaiting: number }>,
  ): Promise<void> {
    this.logger.debug('Validating flow stats index')

    try {
      if (!this.store.index.read || !this.store.index.delete || !this.store.index.update) {
        this.logger.debug('Store does not support stats validation operations')
        return
      }

      const { StoreSubjects } = useStreamTopics()
      const statsIndexKey = StoreSubjects.flowIndex()

      // Read all flow stats entries
      const statsEntries = await this.store.index.read(statsIndexKey, { limit: 10000 })

      let removedCount = 0
      let correctedCount = 0

      for (const entry of statsEntries) {
        const flowName = entry.id

        // Check if this flow still exists in the registry
        if (!validFlowNames.includes(flowName)) {
          this.logger.info(`Removing stats for non-existent flow '${flowName}'`)
          await this.store.index.delete(statsIndexKey, flowName)
          removedCount++
          continue
        }

        // Validate stats structure
        if (!entry.metadata?.stats) {
          this.logger.warn(`Flow stats entry missing stats object for '${flowName}'`)
          continue
        }

        const stats = entry.metadata.stats
        const actual = actualCounts[flowName] || { running: 0, awaiting: 0 }

        // Check if running/awaiting counts match reality
        const runningMismatch = stats.running !== actual.running
        const awaitingMismatch = stats.awaiting !== actual.awaiting

        if (runningMismatch || awaitingMismatch) {
          this.logger.warn(`Flow stats mismatch detected for '${flowName}' - stored: running=${stats.running} awaiting=${stats.awaiting}, actual: running=${actual.running} awaiting=${actual.awaiting} - correcting`)

          // Update stats to match actual scanned values
          await this.store.index.update(statsIndexKey, flowName, {
            stats: {
              running: actual.running,
              awaiting: actual.awaiting,
            },
          })

          correctedCount++
        }
      }

      if (removedCount > 0 || correctedCount > 0) {
        this.logger.info(`Flow stats validation completed - removed ${removedCount} orphaned stats, corrected ${correctedCount} running/awaiting counts`)
      }
      else {
        this.logger.debug('Flow stats validation completed - all stats accurate')
      }
    }
    catch (error) {
      this.logger.error(`Failed to validate flow stats: ${(error as Error).message}`)
    }
  }

  /**
   * Internal method for periodic checks
   * Gets flow names from registry and checks them
   */
  private async checkAllRunningFlows(): Promise<void> {
    try {
      // Get all flow names from the analyzed flows registry
      const analyzedFlows = $useAnalyzedFlows() as any[]
      const flowNames = analyzedFlows.map((f: any) => f.id).filter(Boolean)

      if (flowNames.length === 0) {
        this.logger.debug('No flows registered, skipping stall check')
        return
      }

      await this.checkFlowsForStalls(flowNames)
    }
    catch (error) {
      this.logger.error(`Failed to run periodic stall check: ${(error as Error).message}`)
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
