import type { AwaitConfig } from '../../../../registry/types'
import { useNventLogger } from '#imports'
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
      eventName: config.event,
      filterKey: config.filterKey,
      timeout: config.timeout,
      registeredAt: Date.now(),
    },
  } as any)

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

  logger.info(`Resolving event await`, { runId, stepName })

  // Emit await.resolved event (wiring will handle cleanup and processing)
  eventBus.publish({
    type: 'await.resolved',
    flowName,
    runId,
    stepName,
    position,
    triggerData: eventData,
    data: {
      resolvedAt: Date.now(),
    },
  } as any)

  logger.debug(`Event await resolved`, { runId, stepName })
}
