import type { AwaitConfig } from '../../../../registry/types'
import { useNventLogger } from '#imports'
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
  position: 'before' | 'after' = 'after',
) {
  const logger = useNventLogger('await-time')
  const eventBus = getEventBus()

  if (!config.delay) {
    throw new Error('Time await requires delay configuration (in milliseconds)')
  }

  logger.info(`Registering time await: ${config.delay}ms`, { runId, stepName })

  const resolveAt = Date.now() + config.delay

  // Schedule the resolution
  setTimeout(async () => {
    await resolveTimeAwait(runId, stepName, flowName, position, { delayCompleted: true })
  }, config.delay)

  // Emit await.registered event (wiring will handle storage)
  eventBus.publish({
    type: 'await.registered',
    flowName,
    runId,
    stepName,
    awaitType: 'time',
    position,
    config,
    data: {
      delay: config.delay,
      resolveAt,
      registeredAt: Date.now(),
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
  flowName: string,
  position: 'before' | 'after',
  timeData: any,
) {
  const logger = useNventLogger('await-time')
  const eventBus = getEventBus()

  logger.info(`Resolving time await`, { runId, stepName })

  // Emit await.resolved event (wiring will handle cleanup and processing)
  eventBus.publish({
    type: 'await.resolved',
    flowName,
    runId,
    stepName,
    position,
    triggerData: timeData,
    data: {
      resolvedAt: Date.now(),
    },
  } as any)

  logger.debug(`Time await resolved`, { runId, stepName })
}
