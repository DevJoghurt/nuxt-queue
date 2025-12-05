import type { AwaitConfig } from '../../../../registry/types'
import { useNventLogger, useScheduler } from '#imports'
import { getEventBus } from '../../../events/eventBus'

/**
 * Await Pattern: Event
 *
 * Waits for a specific event to be emitted (internal or external)
 * Useful for cross-flow coordination, external system notifications
 */
export async function registerEventAwait(
  runId: string,
  stepName: string,
  flowName: string,
  config: AwaitConfig,
  position: 'before' | 'after' = 'after',
) {
  const logger = useNventLogger('await-event')
  const eventBus = getEventBus()

  if (!config.event) {
    throw new Error('Event await requires event name configuration')
  }

  logger.info(`Registering event await: ${config.event}`, { runId, stepName })

  // Subscribe to the target event
  const unsubscribe = eventBus.onType(config.event, async (event: any) => {
    // Check if this event matches our await (filterKey matching)
    if (config.filterKey) {
      const awaitValue = (event.data as any)?.[config.filterKey]
      const stepValue = (event.data as any)?.stepData?.[config.filterKey]

      if (awaitValue !== stepValue) {
        return // Event doesn't match our filter
      }
    }

    // Event matches - resolve the await
    await resolveEventAwait(runId, stepName, flowName, position, event.data)
    unsubscribe() // Clean up subscription
  })

  // Calculate timeout with default
  const timeoutMs = config.timeout && config.timeout > 0 ? config.timeout : (24 * 60 * 60 * 1000) // 24 hours default

  // Emit await.registered event (wiring will handle storage)
  eventBus.publish({
    type: 'await.registered',
    flowName,
    runId,
    stepName,
    awaitType: 'event',
    position,
    config,
    data: {
      position, // Store position in data for database persistence
      eventName: config.event,
      filterKey: config.filterKey,
      timeout: timeoutMs, // Store resolved timeout (with default)
      registeredAt: Date.now(),
      timeoutAction: config.timeoutAction || 'fail',
    },
  } as any)

  // Schedule timeout using the already calculated timeoutMs
  const scheduler = useScheduler()
  const timeoutAt = Date.now() + timeoutMs
  const jobId = `await-event-timeout-${runId}-${stepName}-${position}`

  await scheduler.schedule({
    id: jobId,
    name: `Event Await Timeout: ${flowName} - ${stepName}`,
    type: 'one-time',
    executeAt: timeoutAt,
    handler: async () => {
      logger.warn('Event await timeout', {
        runId,
        stepName,
        flowName,
        eventName: config.event,
        timeout: timeoutMs,
        timeoutAction: config.timeoutAction || 'fail',
      })

      // Emit timeout event
      eventBus.publish({
        type: 'await.timeout',
        flowName,
        runId,
        stepName,
        position,
        awaitType: 'event',
        timeoutAction: config.timeoutAction || 'fail',
        data: {
          eventName: config.event,
          timeout: timeoutMs,
          registeredAt: Date.now() - timeoutMs,
          timedOutAt: Date.now(),
        },
      } as any)

      // Clean up the event subscription
      unsubscribe()
    },
    metadata: {
      component: 'await-pattern',
      awaitType: 'event',
      runId,
      stepName,
      flowName,
      position,
      timeout: timeoutMs,
      eventName: config.event,
    },
  })

  logger.debug(`Event timeout scheduled`, {
    runId,
    stepName,
    eventName: config.event,
    timeout: timeoutMs,
    timeoutAction: config.timeoutAction,
    isDefault: !config.timeout || config.timeout <= 0,
  })

  logger.debug(`Event await registered: ${config.event}`, { runId, stepName })

  return {
    eventName: config.event,
    timeout: config.timeout,
  }
}

/**
 * Resolve event await when target event is received
 */
export async function resolveEventAwait(
  runId: string,
  stepName: string,
  flowName: string,
  position: 'before' | 'after',
  eventData: any,
) {
  const logger = useNventLogger('await-event')
  const eventBus = getEventBus()
  const scheduler = useScheduler()

  logger.info(`Resolving event await`, { runId, stepName })

  // Unschedule timeout job if exists
  const jobId = `await-event-timeout-${runId}-${stepName}-${position}`
  try {
    await scheduler.unschedule(jobId)
    logger.debug('Unscheduled event timeout job', { runId, stepName, jobId })
  }
  catch {
    // Job might not exist or already executed, that's fine
    logger.debug('Could not unschedule timeout job (may not exist)', { runId, stepName, jobId })
  }

  // Emit await.resolved event (wiring will handle cleanup and processing)
  eventBus.publish({
    type: 'await.resolved',
    flowName,
    runId,
    stepName,
    position,
    triggerData: eventData,
    data: {
      position, // Store position in data for database persistence
      resolvedAt: Date.now(),
    },
  } as any)

  logger.debug(`Event await resolved`, { runId, stepName })
}
