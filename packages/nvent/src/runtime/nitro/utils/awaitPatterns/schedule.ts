import type { AwaitConfig } from '../../../../registry/types'
import { useNventLogger } from '#imports'
import { getEventBus } from '../../../events/eventBus'

/**
 * Await Pattern: Schedule
 *
 * Waits until next cron schedule occurrence
 * Useful for batch processing, daily reports, scheduled operations
 */
export async function registerScheduleAwait(
  runId: string,
  stepName: string,
  flowName: string,
  config: AwaitConfig,
  position: 'before' | 'after' = 'after',
) {
  const logger = useNventLogger('await-schedule')
  const eventBus = getEventBus()

  if (!config.cron) {
    throw new Error('Schedule await requires cron expression configuration')
  }

  logger.info(`Registering schedule await: ${config.cron}`, { runId, stepName })

  // Calculate next occurrence
  const nextOccurrence = calculateNextCronOccurrence(
    config.cron,
    config.nextAfterHours,
    config.timezone,
  )

  const timeUntilNext = nextOccurrence - Date.now()

  // Schedule the resolution
  // Note: In production, this should be handled by a dedicated scheduler service
  // For now, we'll use a simple setTimeout
  setTimeout(async () => {
    await resolveScheduleAwait(runId, stepName, flowName, position, { scheduledAt: nextOccurrence })
  }, timeUntilNext)

  // Emit await.registered event (wiring will handle storage)
  eventBus.publish({
    type: 'await.registered',
    flowName,
    runId,
    stepName,
    awaitType: 'schedule',
    position,
    config,
    data: {
      cron: config.cron,
      nextOccurrence,
      timeUntilNext,
      registeredAt: Date.now(),
    },
  } as any)

  logger.debug(`Schedule await registered: ${config.cron} (next: ${new Date(nextOccurrence).toISOString()})`, {
    runId,
    stepName,
  })

  return {
    cron: config.cron,
    nextOccurrence,
    timeUntilNext,
  }
}

/**
 * Calculate next cron occurrence
 */
function calculateNextCronOccurrence(
  cron: string,
  nextAfterHours?: number,
  timezone?: string,
): number {
  // Simple cron parser - in production, use a proper library like 'cron-parser'
  // For now, return a fixed future time
  const baseTime = Date.now() + (nextAfterHours || 0) * 3600 * 1000

  // TODO: Implement proper cron parsing with timezone support
  // For now, add 24 hours as a placeholder
  return baseTime + 24 * 3600 * 1000
}

/**
 * Resolve schedule await when cron time is reached
 */
export async function resolveScheduleAwait(
  runId: string,
  stepName: string,
  flowName: string,
  position: 'before' | 'after',
  scheduleData: any,
) {
  const logger = useNventLogger('await-schedule')
  const eventBus = getEventBus()

  logger.info(`Resolving schedule await`, { runId, stepName })

  // Emit await.resolved event (wiring will handle cleanup and processing)
  eventBus.publish({
    type: 'await.resolved',
    flowName,
    runId,
    stepName,
    position,
    triggerData: scheduleData,
    data: {
      resolvedAt: Date.now(),
    },
  } as any)

  logger.debug(`Schedule await resolved`, { runId, stepName })
}
