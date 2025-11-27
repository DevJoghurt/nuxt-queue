import type { AwaitConfig } from '../../../../registry/types'
import { useNventLogger, useScheduler } from '#imports'
import { getEventBus } from '../../../events/eventBus'
import { CronJob } from 'cron'

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
  const scheduler = useScheduler()

  if (!config.cron) {
    throw new Error('Schedule await requires cron expression configuration')
  }

  logger.info(`Registering schedule await: ${config.cron}`, { runId, stepName })

  // Calculate next occurrence using cron library
  const cronJob = new CronJob(config.cron, () => {}, null, false, config.timezone || 'UTC')
  const nextDate = cronJob.nextDate()
  const nextOccurrence = nextDate ? nextDate.toMillis() : Date.now() + 60000 // Fallback to 1 minute

  const timeUntilNext = nextOccurrence - Date.now()

  // Schedule the resolution using scheduler
  const jobId = `await-schedule-${runId}-${stepName}-${position}`
  await scheduler.schedule({
    id: jobId,
    name: `Schedule Await: ${flowName} - ${stepName}`,
    type: 'one-time',
    executeAt: nextOccurrence,
    handler: async () => {
      await resolveScheduleAwait(runId, stepName, flowName, position, { scheduledAt: nextOccurrence })
    },
    metadata: {
      component: 'await-pattern',
      awaitType: 'schedule',
      runId,
      stepName,
      flowName,
      position,
      cron: config.cron,
      timezone: config.timezone,
    },
  })

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
