import type { AwaitConfig } from '../../../../registry/types'
import { useNventLogger, useStoreAdapter, useStreamTopics } from '#imports'
import { getEventBus } from '../../../events/eventBus'

/**
 * Await Pattern: Time
 *
 * Simple delay/timeout - waits for a specific duration
 * Useful for cooldown periods, rate limiting, delayed notifications
 */
export async function registerTimeAwait(
  runId: string,
  stepName: string,
  flowName: string,
  config: AwaitConfig,
) {
  const logger = useNventLogger('await-time')
  const store = useStoreAdapter()
  const eventBus = getEventBus()
  const { SubjectPatterns } = useStreamTopics()

  if (!config.delay) {
    throw new Error('Time await requires delay configuration (in milliseconds)')
  }

  logger.info(`Registering time await: ${config.delay}ms`, { runId, stepName })

  const resolveAt = Date.now() + config.delay

  // Store await registration
  if (store.kv?.set) {
    const statusKey = SubjectPatterns.awaitStatus(runId, stepName)
    await store.kv.set(
      statusKey,
      {
        runId,
        stepName,
        flowName,
        awaitType: 'time',
        delay: config.delay,
        resolveAt,
        registeredAt: Date.now(),
      },
      Math.floor(config.delay / 1000) + 60, // TTL with buffer
    )
  }

  // Schedule the resolution
  setTimeout(async () => {
    await resolveTimeAwait(runId, stepName, { delayCompleted: true })
  }, config.delay)

  // Emit await.registered event
  eventBus.publish({
    type: 'await.registered',
    flowName,
    runId,
    stepName,
    data: {
      awaitType: 'time',
      delay: config.delay,
      resolveAt,
    },
  } as any)

  logger.debug(`Time await registered: ${config.delay}ms`, { runId, stepName })

  return {
    delay: config.delay,
    resolveAt,
  }
}

/**
 * Resolve time await when delay completes
 */
export async function resolveTimeAwait(
  runId: string,
  stepName: string,
  timeData: any,
) {
  const logger = useNventLogger('await-time')
  const eventBus = getEventBus()
  const store = useStoreAdapter()
  const { SubjectPatterns } = useStreamTopics()

  logger.info(`Resolving time await`, { runId, stepName })

  // Get flow name from runId
  const flowName = runId.split('-')[0]

  // Emit await.resolved event
  eventBus.publish({
    type: 'await.resolved',
    flowName,
    runId,
    stepName,
    data: {
      triggerData: timeData,
      resolvedAt: Date.now(),
    },
  } as any)

  // Clean up KV entries
  if (store.kv?.delete) {
    const statusKey = SubjectPatterns.awaitStatus(runId, stepName)
    await store.kv.delete(statusKey)
  }

  logger.debug(`Time await resolved`, { runId, stepName })
}
