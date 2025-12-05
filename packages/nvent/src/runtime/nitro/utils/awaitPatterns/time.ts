import type { AwaitConfig } from '../../../../registry/types'
import { useNventLogger, useScheduler } from '#imports'
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
  const scheduler = useScheduler()

  if (!config.delay) {
    throw new Error('Time await requires delay configuration (in milliseconds)')
  }

  logger.info(`Registering time await: ${config.delay}ms`, { runId, stepName })

  const resolveAt = Date.now() + config.delay

  // Schedule the resolution using the scheduler
  const jobId = `await-time-${runId}-${stepName}-${position}`
  await scheduler.schedule({
    id: jobId,
    name: `Time Await: ${flowName} - ${stepName}`,
    type: 'one-time',
    executeAt: resolveAt,
    handler: async () => {
      await resolveTimeAwait(runId, stepName, flowName, position, { delayCompleted: true })
    },
    metadata: {
      component: 'await-pattern',
      awaitType: 'time',
      runId,
      stepName,
      flowName,
      position,
      delay: config.delay,
    },
  })

  // Emit await.registered event
  eventBus.publish({
    type: 'await.registered',
    flowName,
    runId,
    stepName,
    awaitType: 'time',
    position,
    config,
    data: {
      position, // Store position in data for database persistence
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
    triggerData: {},
    data: {
      position, // Store position in data for database persistence
      resolvedAt: Date.now(),
    },
  } as any)

  logger.debug(`Time await resolved`, { runId, stepName })
}
