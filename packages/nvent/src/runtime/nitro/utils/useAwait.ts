import type { AwaitConfig } from '../../../registry/types'
import {
  registerAwaitPattern,
  resolveAwaitPattern,
  registerWebhookAwait,
  resolveWebhookAwait,
  registerEventAwait,
  resolveEventAwait,
  registerScheduleAwait,
  resolveScheduleAwait,
  registerTimeAwait,
  resolveTimeAwait,
} from './awaitPatterns'
import { useStoreAdapter, useStreamTopics, useNventLogger } from '#imports'

/**
 * Await pattern composable
 * Provides unified API for managing await patterns in flows
 * Separate from useTrigger which handles entry triggers (manual, webhook, schedule, event)
 */
export function useAwait() {
  const logger = useNventLogger('await')
  const store = useStoreAdapter()
  const { StoreSubjects } = useStreamTopics()

  return {
    /**
     * Register an await pattern based on config type
     * Automatically routes to appropriate implementation
     */
    register: registerAwaitPattern,

    /**
     * Resolve an await pattern by type
     */
    resolve: resolveAwaitPattern,

    /**
     * Direct access to specific await pattern implementations
     */
    webhook: {
      register: registerWebhookAwait,
      resolve: resolveWebhookAwait,
    },
    event: {
      register: registerEventAwait,
      resolve: resolveEventAwait,
    },
    schedule: {
      register: registerScheduleAwait,
      resolve: resolveScheduleAwait,
    },
    time: {
      register: registerTimeAwait,
      resolve: resolveTimeAwait,
    },

    /**
     * Query methods for await state
     */

    /**
     * Get await state for a specific flow run and step
     */
    async getAwaitState(flowName: string, runId: string, stepName?: string) {
      const indexKey = StoreSubjects.flowRunIndex(flowName)

      if (!store.indexGet) {
        logger.warn('Store does not support indexGet')
        return null
      }

      const entry = await store.indexGet(indexKey, runId)
      if (!entry?.metadata) {
        return null
      }

      const awaitingSteps = (entry.metadata as any).awaitingSteps || {}

      // If stepName specified, return that step's await state
      if (stepName) {
        return awaitingSteps[stepName] || null
      }

      // Otherwise return all awaiting steps
      return awaitingSteps
    },

    /**
     * Check if a step is currently awaiting
     */
    async isAwaiting(flowName: string, runId: string, stepName: string): Promise<boolean> {
      const awaitState = await this.getAwaitState(flowName, runId, stepName)
      return awaitState?.status === 'awaiting'
    },

    /**
     * Get all active awaits across all flows
     */
    async getAllActiveAwaits(flowName?: string) {
      const activeAwaits: Array<{
        flowName: string
        runId: string
        stepName: string
        awaitType: string
        position: 'before' | 'after'
        registeredAt: string
      }> = []

      if (!store.indexScan) {
        logger.warn('Store does not support indexScan')
        return activeAwaits
      }

      // If flowName specified, scan only that flow's index
      if (flowName) {
        const indexKey = StoreSubjects.flowRunIndex(flowName)
        const entries = await store.indexRead(indexKey, { limit: 1000 })

        for (const entry of entries) {
          const awaitingSteps = (entry.metadata as any)?.awaitingSteps || {}

          for (const [stepName, awaitState] of Object.entries(awaitingSteps)) {
            if ((awaitState as any).status === 'awaiting') {
              activeAwaits.push({
                flowName,
                runId: entry.id,
                stepName,
                awaitType: (awaitState as any).awaitType,
                position: (awaitState as any).position,
                registeredAt: (awaitState as any).registeredAt,
              })
            }
          }
        }
      }
      else {
        // Scan all flow indices (would need to know all flow names)
        // For now, log a warning that this is not fully implemented
        logger.warn('Scanning all flows not yet implemented - provide flowName parameter')
      }

      return activeAwaits
    },

    /**
     * Get await history for a specific flow run from stream
     */
    async getAwaitHistory(runId: string, opts?: { limit?: number, stepName?: string }) {
      const streamName = StoreSubjects.flowRun(runId)

      const events = await store.read(streamName, {
        limit: opts?.limit || 100,
        types: ['await.registered', 'await.resolved', 'await.timeout'],
        order: 'desc',
      })

      // Filter by stepName if provided
      if (opts?.stepName) {
        return events.filter((e: any) => e.stepName === opts.stepName)
      }

      return events
    },

    /**
     * Cancel/timeout an active await
     */
    async timeoutAwait(flowName: string, runId: string, stepName: string, reason: string = 'Manual timeout') {
      const indexKey = StoreSubjects.flowRunIndex(flowName)

      // Update await status to timeout
      if (store.indexUpdateWithRetry) {
        await store.indexUpdateWithRetry(indexKey, runId, {
          [`awaitingSteps.${stepName}.status`]: 'timeout',
          [`awaitingSteps.${stepName}.timeoutReason`]: reason,
          [`awaitingSteps.${stepName}.timeoutAt`]: new Date().toISOString(),
        })

        logger.info('Await timed out', { flowName, runId, stepName, reason })
      }

      // Publish await.timeout event (will be handled by flowWiring)
      // Note: This would need event bus access, which we should add if needed
      logger.warn('await.timeout event publishing not yet implemented in useAwait')
    },
  }
}

// Export types for convenience
export type { AwaitConfig }
