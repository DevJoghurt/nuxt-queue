import type { StoreAdapter } from '../../adapters/interfaces/store'
import { useNventLogger, useStoreAdapter, useStreamTopics } from '#imports'

/**
 * Clean up all await patterns for a flow when it reaches a terminal state
 * Handles cleanup of webhooks, event listeners, scheduled jobs, and blocked emits
 */
export async function cleanupFlowAwaits(
  flowName: string,
  runId: string,
  reason: 'completed' | 'canceled' | 'stalled' | 'failed',
): Promise<void> {
  const logger = useNventLogger('await-cleanup')
  const store = useStoreAdapter()
  const { SubjectPatterns } = useStreamTopics()

  try {
    // Get awaiting steps from flow run metadata
    const indexKey = SubjectPatterns.flowRunIndex(flowName)

    if (!store.indexGet) {
      logger.warn('Store does not support index operations, skipping cleanup')
      return
    }

    const flowEntry = await store.indexGet(indexKey, runId)
    const awaitingSteps = flowEntry?.metadata?.awaitingSteps || {}

    if (Object.keys(awaitingSteps).length === 0) {
      logger.debug('No awaiting steps to clean up', { flowName, runId })
      return
    }

    logger.info('Cleaning up await patterns', {
      flowName,
      runId,
      reason,
      awaitCount: Object.keys(awaitingSteps).length,
    })

    // Clean up each await pattern
    const cleanupPromises = Object.entries(awaitingSteps).map(
      async ([stepName, awaitInfo]: [string, any]) => {
        try {
          await cleanupAwaitPattern(
            flowName,
            runId,
            stepName,
            awaitInfo,
            reason,
          )
        }
        catch (error) {
          logger.error('Failed to clean up await pattern', {
            flowName,
            runId,
            stepName,
            error: (error as Error).message,
          })
        }
      },
    )

    await Promise.all(cleanupPromises)

    // Clear awaitingSteps from metadata
    if (store.indexUpdateWithRetry) {
      await store.indexUpdateWithRetry(indexKey, runId, {
        awaitingSteps: {},
      })
    }

    logger.info('Await cleanup completed', {
      flowName,
      runId,
      cleanedCount: Object.keys(awaitingSteps).length,
    })
  }
  catch (error) {
    logger.error('Failed to clean up flow awaits', {
      flowName,
      runId,
      error: (error as Error).message,
    })
  }
}

/**
 * Clean up a single await pattern
 */
async function cleanupAwaitPattern(
  flowName: string,
  runId: string,
  stepName: string,
  awaitInfo: any,
  reason: string,
): Promise<void> {
  const logger = useNventLogger('await-cleanup')
  const store = useStoreAdapter()

  logger.debug('Cleaning up await pattern', {
    flowName,
    runId,
    stepName,
    awaitType: awaitInfo.awaitType,
    position: awaitInfo.position,
    reason,
  })

  // Cleanup based on await type
  switch (awaitInfo.awaitType) {
    case 'webhook':
      await cleanupWebhookAwait(runId, stepName, awaitInfo, store)
      break

    case 'event':
      await cleanupEventAwait(runId, stepName, awaitInfo, store)
      break

    case 'schedule':
      await cleanupScheduleAwait(runId, stepName, awaitInfo, store)
      break

    case 'time':
      await cleanupTimeAwait(runId, stepName, awaitInfo, store)
      break

    default:
      logger.warn('Unknown await type, skipping cleanup', {
        awaitType: awaitInfo.awaitType,
      })
  }

  // Clean up blocked emits if any (awaitAfter) - now in metadata, no KV needed
  if (awaitInfo.blockedEmits && Array.isArray(awaitInfo.blockedEmits)) {
    logger.debug('Blocked emits will be cleaned up with awaitingSteps metadata', {
      runId,
      stepName,
      count: awaitInfo.blockedEmits.length,
    })
  }
}

/**
 * Clean up webhook await pattern
 */
async function cleanupWebhookAwait(
  runId: string,
  stepName: string,
  awaitInfo: any,
  store: StoreAdapter,
): Promise<void> {
  const logger = useNventLogger('await-cleanup')

  if (!store.kv?.delete)
    return

  // Extract webhook ID from URL (format: /await/{webhookId})
  const webhookUrl = awaitInfo.webhookUrl
  if (webhookUrl) {
    const match = webhookUrl.match(/\/await\/([^/]+)/)
    const webhookId = match?.[1]
    if (webhookId) {
      await store.kv.delete(`await:webhook:${webhookId}`)
      logger.debug('Cleaned up webhook routing', {
        runId,
        stepName,
        webhookId,
      })
    }
  }

  // Clean up timeout tracker
  await store.kv.delete(`await:timeout:${runId}:${stepName}`)
}

/**
 * Clean up event await pattern
 */
async function cleanupEventAwait(
  runId: string,
  stepName: string,
  awaitInfo: any,
  store: StoreAdapter,
): Promise<void> {
  const logger = useNventLogger('await-cleanup')

  if (!store.kv?.delete)
    return

  // Event awaits use event name as listener identifier
  // The event system will ignore events for non-existent awaits
  // Just clean up timeout tracker
  await store.kv.delete(`await:timeout:${runId}:${stepName}`)

  logger.debug('Cleaned up event await', {
    runId,
    stepName,
    eventName: awaitInfo.eventName,
  })
}

/**
 * Clean up schedule await pattern
 */
async function cleanupScheduleAwait(
  runId: string,
  stepName: string,
  awaitInfo: any,
  store: StoreAdapter,
): Promise<void> {
  const logger = useNventLogger('await-cleanup')

  if (!store.kv?.delete)
    return

  // Schedule awaits should cancel any pending scheduled jobs
  // This depends on the scheduler implementation
  // For now, just clean up timeout tracker
  await store.kv.delete(`await:timeout:${runId}:${stepName}`)

  logger.debug('Cleaned up schedule await', {
    runId,
    stepName,
    schedule: awaitInfo.schedule,
  })
}

/**
 * Clean up time await pattern
 */
async function cleanupTimeAwait(
  runId: string,
  stepName: string,
  awaitInfo: any,
  store: StoreAdapter,
): Promise<void> {
  const logger = useNventLogger('await-cleanup')

  if (!store.kv?.delete)
    return

  // Time awaits use timers/timeouts
  // Clean up timeout tracker
  await store.kv.delete(`await:timeout:${runId}:${stepName}`)

  logger.debug('Cleaned up time await', {
    runId,
    stepName,
    duration: awaitInfo.duration,
  })
}
