import { useNventLogger, useScheduler } from '#imports'
import { getEventBus } from '../eventBus'

/**
 * Schedule or update a schedule trigger in the scheduler
 */
export async function scheduleTrigger(triggerName: string, scheduleConfig: any, triggerStatus?: string): Promise<void> {
  const logger = useNventLogger('trigger-wiring')
  const scheduler = useScheduler()
  const eventBus = getEventBus()

  try {
    const jobId = `trigger:${triggerName}`
    const isEnabled = triggerStatus === 'active'

    // Job handler: fire the trigger
    const handler = async () => {
      logger.debug('Schedule trigger fired', { trigger: triggerName })

      // Publish trigger.fired event
      await eventBus.publish({
        type: 'trigger.fired',
        triggerName,
        data: {
          scheduledAt: Date.now(),
          timezone: scheduleConfig.timezone || 'UTC',
        },
      } as any)
    }

    // Unschedule existing job if it exists (for updates)
    await scheduler.unschedule(jobId)

    // Create new schedule job
    const jobConfig: any = {
      id: jobId,
      type: scheduleConfig.cron ? 'cron' : 'interval',
      name: `Schedule Trigger: ${triggerName}`,
      handler,
      metadata: {
        triggerName,
        type: 'schedule-trigger',
        scheduleConfig,
      },
      enabled: isEnabled,
    }

    // Add schedule-specific fields
    if (scheduleConfig.cron) {
      jobConfig.cron = scheduleConfig.cron
      jobConfig.timezone = scheduleConfig.timezone || 'UTC'
    }
    else if (scheduleConfig.interval) {
      jobConfig.interval = scheduleConfig.interval * 1000 // Convert seconds to milliseconds
    }

    await scheduler.schedule(jobConfig)

    logger.info('Scheduled trigger', {
      trigger: triggerName,
      enabled: isEnabled,
      cron: scheduleConfig.cron,
      interval: scheduleConfig.interval,
      timezone: scheduleConfig.timezone,
    })
  }
  catch (error) {
    logger.error('Failed to schedule trigger', {
      trigger: triggerName,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

/**
 * Unschedule a schedule trigger from the scheduler
 */
export async function unscheduleTrigger(triggerName: string): Promise<void> {
  const logger = useNventLogger('trigger-wiring')
  const scheduler = useScheduler()

  try {
    const jobId = `trigger:${triggerName}`
    const removed = await scheduler.unschedule(jobId)

    if (removed) {
      logger.info('Unscheduled trigger', { trigger: triggerName })
    }
  }
  catch (error) {
    logger.error('Failed to unschedule trigger', {
      trigger: triggerName,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
