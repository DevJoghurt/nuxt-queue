import type { AwaitConfig } from '../../../registry/types'
import { useNventLogger, useStoreAdapter, useStreamTopics } from '#imports'
import { getEventBus } from '../../events/eventBus'

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
) {
  const logger = useNventLogger('await-schedule')
  const store = useStoreAdapter()
  const eventBus = getEventBus()
  const { SubjectPatterns } = useStreamTopics()

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

  // Store await registration
  if (store.kv?.set) {
    const statusKey = SubjectPatterns.awaitStatus(runId, stepName)
    await store.kv.set(
      statusKey,
      {
        runId,
        stepName,
        flowName,
        awaitType: 'schedule',
        cron: config.cron,
        nextOccurrence,
        registeredAt: Date.now(),
      },
      config.timeout ? Math.floor(config.timeout / 1000) : Math.floor(timeUntilNext / 1000) + 60,
    )
  }

  // Schedule the resolution
  // Note: In production, this should be handled by a dedicated scheduler service
  // For now, we'll use a simple setTimeout
  setTimeout(async () => {
    await resolveScheduleAwait(runId, stepName, { scheduledAt: nextOccurrence })
  }, timeUntilNext)

  // Emit await.registered event
  eventBus.publish({
    type: 'await.registered',
    flowName,
    runId,
    stepName,
    data: {
      awaitType: 'schedule',
      cron: config.cron,
      nextOccurrence,
      timeUntilNext,
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
  scheduleData: any,
) {
  const logger = useNventLogger('await-schedule')
  const eventBus = getEventBus()
  const store = useStoreAdapter()
  const { SubjectPatterns } = useStreamTopics()

  logger.info(`Resolving schedule await`, { runId, stepName })

  // Get flow name from runId
  const flowName = runId.split('-')[0]

  // Emit await.resolved event
  eventBus.publish({
    type: 'await.resolved',
    flowName,
    runId,
    stepName,
    data: {
      triggerData: scheduleData,
      resolvedAt: Date.now(),
    },
  } as any)

  // Clean up KV entries
  if (store.kv?.delete) {
    const statusKey = SubjectPatterns.awaitStatus(runId, stepName)
    await store.kv.delete(statusKey)
  }

  logger.debug(`Schedule await resolved`, { runId, stepName })
}
