/**
 * Flow Stall Detection System
 *
 * Detects and marks flows that have been in "running" state for too long without activity.
 * Uses per-flow scheduler jobs for precise timeout tracking:
 *
 * - On flow.start: Schedule timeout job with flow-specific deadline
 * - On step events: Reschedule to extend timeout from current time
 * - On flow end: Unschedule the timeout job
 * - When timeout fires: Mark flow as stalled
 *
 * Startup recovery handles flows left running from previous server instance.
 */

import type { StoreAdapter } from '../../adapters/interfaces/store'
import { useNventLogger, useStreamTopics, $useAnalyzedFlows } from '#imports'

export interface StallDetectorConfig {
  /**
   * Enable stall detection system
   * @default true
   */
  enabled?: boolean
}

export type FlowStatus = 'running' | 'completed' | 'failed' | 'canceled' | 'stalled'

export class FlowStallDetector {
  private store: StoreAdapter
  private config: Required<StallDetectorConfig>
  private logger = useNventLogger('stall-detector')
  private started = false

  constructor(store: StoreAdapter, config: StallDetectorConfig = {}) {
    this.store = store
    this.config = {
      enabled: config.enabled ?? true,
    }
  }

  /**
   * Start the stall detector
   * Runs startup recovery to clean up flows from previous server instances
   * Note: Periodic checking removed - now uses per-flow scheduler jobs
   */
  async start(): Promise<void> {
    if (this.started) {
      this.logger.warn('Stall detector already started')
      return
    }

    this.started = true

    // Run startup recovery first to handle flows left running from previous instance
    await this.runStartupRecovery()

    this.logger.info('Stall detector started - using per-flow scheduler jobs for stall timeouts')
  }

  /**
   * Stop the stall detector
   */
  async stop(): Promise<void> {
    this.started = false
    this.logger.info('Stall detector stopped')
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
   * Get stall detector statistics
   */
  getStats() {
    return {
      enabled: this.started,
      mode: 'per-flow-scheduler',
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
