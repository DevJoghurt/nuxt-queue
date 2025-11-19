import type { EventRecord } from '../../adapters/interfaces/store'
import type { TriggerFiredEvent, AwaitRegisteredEvent, AwaitResolvedEvent, TriggerRegisteredEvent } from '../types'
import { getEventBus } from '../eventBus'
import { useNventLogger, useStoreAdapter, useQueueAdapter, $useAnalyzedFlows, $useQueueRegistry, useStreamTopics } from '#imports'

/**
 * Setup trigger event wiring
 * Listens to trigger.fired events and starts subscribed flows
 */
export async function setupTriggerWiring() {
  const logger = useNventLogger('trigger-wiring')
  const eventBus = getEventBus()
  const { useTrigger } = await import('../../utils/useTrigger')
  const trigger = useTrigger()

  // Initialize trigger runtime
  await trigger.initialize()

  logger.info('Setting up trigger event wiring')

  // Listen to trigger.fired events
  eventBus.onType('trigger.fired', async (event: EventRecord) => {
    try {
      await handleTriggerFired(event as unknown as TriggerFiredEvent)
    }
    catch (error) {
      const triggerName = (event.data as any)?.triggerName || 'unknown'
      logger.error('Error handling trigger.fired event', {
        trigger: triggerName,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })

  // Listen to trigger.registered events for validation
  eventBus.onType('trigger.registered', async (event: EventRecord) => {
    const typedEvent = event as unknown as TriggerRegisteredEvent
    const triggerEntry = trigger.getTrigger(typedEvent.triggerName)
    if (triggerEntry?.expectedSubscribers) {
      const actualFlows = trigger.getSubscribedFlows(typedEvent.triggerName)
      for (const expected of triggerEntry.expectedSubscribers) {
        if (!actualFlows.includes(expected)) {
          logger.warn(
            `Trigger '${typedEvent.triggerName}' expects subscriber '${expected}' `
            + `but it's not registered`,
          )
        }
      }
    }
  })

  logger.info('Trigger event wiring setup complete')
}

/**
 * Handle trigger.fired event
 * Starts all subscribed flows (auto mode) or queues them (manual mode)
 */
export async function handleTriggerFired(event: TriggerFiredEvent) {
  const logger = useNventLogger('trigger-wiring')
  const { useTrigger } = await import('../../utils/useTrigger')
  const trigger = useTrigger()

  const { triggerName, data } = event

  logger.debug('Trigger fired', { trigger: triggerName })

  // Get all subscribed flows
  const subscriptions = trigger.getAllSubscriptions()
    .filter(sub => sub.triggerName === triggerName)

  if (subscriptions.length === 0) {
    logger.warn(`No flows subscribed to trigger: ${triggerName}`)
    return
  }

  // Start each subscribed flow
  for (const subscription of subscriptions) {
    try {
      if (subscription.mode === 'manual') {
        // Manual mode: just log, user must start flow manually
        logger.info(
          `Trigger '${triggerName}' fired for flow '${subscription.flowName}' `
          + `(manual mode - awaiting manual start)`,
        )
        continue
      }

      // Auto mode: start flow automatically
      await startFlowFromTrigger(subscription.flowName, triggerName, data)
    }
    catch (error) {
      logger.error('Error starting flow from trigger', {
        flow: subscription.flowName,
        trigger: triggerName,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

/**
 * Start a flow from a trigger event
 * Simply publishes a flow.start event - let flow wiring handle the rest
 */
export async function startFlowFromTrigger(
  flowName: string,
  triggerName: string,
  triggerData: any,
) {
  const logger = useNventLogger('trigger-wiring')
  const eventBus = getEventBus()
  const analyzedFlows = $useAnalyzedFlows()

  // Verify flow exists
  const flowDef = analyzedFlows.find((f: any) => f.id === flowName) as any
  if (!flowDef) {
    logger.error(`Flow not found: ${flowName}`)
    return
  }

  // Generate run ID
  const runId = `${flowName}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`

  logger.info(`Starting flow '${flowName}' from trigger '${triggerName}'`, { runId })

  // Publish flow.start event - flow wiring will handle the rest
  eventBus.publish({
    type: 'flow.start',
    flowName,
    runId,
    data: {
      input: triggerData,
      trigger: {
        name: triggerName,
        data: triggerData,
      },
    },
  } as EventRecord)
}

/**
 * Setup await pattern wiring
 * Listens to await.registered and await.resolved events
 */
export async function setupAwaitWiring() {
  const logger = useNventLogger('await-wiring')
  const eventBus = getEventBus()
  const store = useStoreAdapter()
  const { SubjectPatterns } = useStreamTopics()

  logger.info('Setting up await pattern event wiring')

  // Listen to await.registered events
  eventBus.onType('await.registered', async (event: EventRecord) => {
    try {
      await handleAwaitRegistered(event as unknown as AwaitRegisteredEvent)
    }
    catch (error) {
      logger.error('Error handling await.registered event', {
        runId: event.runId,
        stepName: event.stepName,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })

  // Listen to await.resolved events
  eventBus.onType('await.resolved', async (event: EventRecord) => {
    try {
      await handleAwaitResolved(event as unknown as AwaitResolvedEvent)
    }
    catch (error) {
      logger.error('Error handling await.resolved event', {
        runId: event.runId,
        stepName: event.stepName,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })

  // Listen to await.timeout events
  eventBus.onType('await.timeout', async (event: EventRecord) => {
    const timeoutData = event.data as any
    logger.warn('Await pattern timed out', {
      runId: event.runId,
      stepName: event.stepName,
      awaitType: timeoutData?.awaitType,
    })

    // Handle timeout action (continue, fail, retry)
    if (timeoutData?.action === 'fail') {
      const streamName = SubjectPatterns.flowRun(event.runId)
      await store.append(streamName, {
        type: 'step.failed',
        flowName: event.flowName,
        runId: event.runId,
        stepName: event.stepName || '',
        stepId: event.stepId || '',
        attempt: event.attempt || 1,
        data: {
          error: 'Await pattern timed out',
        },
      })
    }
    else if (timeoutData?.action === 'continue') {
      // Resume step with null data
      await resumeStepAfterAwait(event.runId, event.stepName || '', null)
    }
  })

  logger.info('Await pattern event wiring setup complete')
}

/**
 * Handle await.registered event
 * Sets up the await listener for the specific trigger pattern
 */
async function handleAwaitRegistered(event: AwaitRegisteredEvent) {
  const logger = useNventLogger('await-wiring')
  const store = useStoreAdapter()
  const { SubjectPatterns } = useStreamTopics()

  const { runId, stepName, awaitType, config: awaitConfig } = event

  logger.debug('Await pattern registered', {
    runId,
    stepName,
    awaitType,
  })

  // Store await registration in dedicated stream
  const awaitStreamName = SubjectPatterns.awaitTrigger(runId, stepName)
  await store.append(awaitStreamName, {
    type: 'await.registered',
    flowName: event.flowName,
    runId,
    stepName,
    data: {
      awaitType,
      awaitConfig,
      registeredAt: new Date().toISOString(),
    },
  })

  // Set expiration if timeout is configured
  if (awaitConfig.timeout) {
    // Schedule timeout check (this would be handled by a background scheduler)
    const timeoutMs = awaitConfig.timeout * 1000
    const timeoutAt = Date.now() + timeoutMs

    // Store timeout metadata
    if (store.kv?.set) {
      await store.kv.set(
        `await:timeout:${runId}:${stepName}`,
        {
          runId,
          stepName,
          awaitType,
          timeoutAt,
          timeoutAction: awaitConfig.timeoutAction || 'fail',
        },
        timeoutMs,
      )
    }
  }
}

/**
 * Handle await.resolved event
 * Resumes the paused step with resolved data
 */
async function handleAwaitResolved(event: AwaitResolvedEvent) {
  const logger = useNventLogger('await-wiring')
  const { runId, stepName, triggerData: resolvedData } = event

  logger.debug('Await pattern resolved', {
    runId,
    stepName,
  })

  // Resume the step
  await resumeStepAfterAwait(runId, stepName, resolvedData)
}

/**
 * Resume a step after await pattern is resolved
 */
async function resumeStepAfterAwait(
  runId: string,
  stepName: string,
  resolvedData: any,
) {
  const logger = useNventLogger('await-wiring')
  const queue = useQueueAdapter()
  const store = useStoreAdapter()
  const { SubjectPatterns } = useStreamTopics()
  const registry = $useQueueRegistry() as any

  // Get flow name from runId
  const flowName = runId.split('-')[0]

  // Get flow metadata
  const indexKey = SubjectPatterns.flowRunIndex(flowName)
  if (!store.indexGet) return
  const flowEntry = await store.indexGet(indexKey, runId)
  if (!flowEntry) {
    logger.error('Flow entry not found', { runId })
    return
  }

  // Append await.resolved event to flow stream
  const streamName = SubjectPatterns.flowRun(runId)
  await store.append(streamName, {
    type: 'await.resolved',
    flowName,
    runId,
    stepName,
    data: {
      resolvedData,
    },
  })

  // Get step metadata
  const flowRegistry = (registry?.flows || {})[flowName]
  const stepMeta = flowRegistry?.steps?.[stepName]

  if (stepMeta?.queue) {
    // Re-queue the step with resolved data
    await queue.enqueue(stepMeta.queue, {
      name: stepName,
      data: {
        flowName,
        runId,
        stepName,
        awaitResolved: true,
        awaitData: resolvedData,
      },
    })

    logger.info(`Resumed step '${stepName}' after await resolution`, { runId })
  }
}
