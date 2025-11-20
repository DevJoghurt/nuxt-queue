import type { AwaitConfig } from '../../../../registry/types'
import { useNventLogger, useStoreAdapter, useStreamTopics } from '#imports'
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
) {
  const logger = useNventLogger('await-event')
  const store = useStoreAdapter()
  const eventBus = getEventBus()
  const { SubjectPatterns } = useStreamTopics()

  if (!config.event) {
    throw new Error('Event await requires event name configuration')
  }

  logger.info(`Registering event await: ${config.event}`, { runId, stepName })

  // Store await registration
  if (store.kv?.set) {
    const statusKey = SubjectPatterns.awaitStatus(runId, stepName)
    await store.kv.set(
      statusKey,
      {
        runId,
        stepName,
        flowName,
        awaitType: 'event',
        eventName: config.event,
        filterKey: config.filterKey,
        registeredAt: Date.now(),
      },
      config.timeout ? Math.floor(config.timeout / 1000) : undefined,
    )
  }

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
    await resolveEventAwait(runId, stepName, event.data)
    unsubscribe() // Clean up subscription
  })

  // Emit await.registered event
  eventBus.publish({
    type: 'await.registered',
    flowName,
    runId,
    stepName,
    data: {
      awaitType: 'event',
      eventName: config.event,
      filterKey: config.filterKey,
      timeout: config.timeout,
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
  eventData: any,
) {
  const logger = useNventLogger('await-event')
  const eventBus = getEventBus()
  const store = useStoreAdapter()
  const { SubjectPatterns } = useStreamTopics()

  logger.info(`Resolving event await`, { runId, stepName })

  // Get flow name from runId
  const flowName = runId.split('-')[0]

  // Emit await.resolved event
  eventBus.publish({
    type: 'await.resolved',
    flowName,
    runId,
    stepName,
    data: {
      triggerData: eventData,
      resolvedAt: Date.now(),
    },
  } as any)

  // Clean up KV entries
  if (store.kv?.delete) {
    const statusKey = SubjectPatterns.awaitStatus(runId, stepName)
    await store.kv.delete(statusKey)
  }

  logger.debug(`Event await resolved`, { runId, stepName })
}
