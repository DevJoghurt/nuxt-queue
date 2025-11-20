import type { EventRecord } from '../../adapters/interfaces/store'
import type { TriggerFiredEvent, AwaitRegisteredEvent, AwaitResolvedEvent } from '../types'
import { getEventBus } from '../eventBus'
import { checkAndTriggerPendingSteps } from './flowWiring'
import { useRunContext, useTrigger, useHookRegistry, useNventLogger, useStoreAdapter, useQueueAdapter, $useAnalyzedFlows, $useQueueRegistry, useStreamTopics } from '#imports'

/**
 * Create trigger event wiring
 * Listens to trigger.fired events and starts subscribed flows
 * Handles await.registered and await.resolved events
 */
export function createTriggerWiring() {
  const unsubs: Array<() => void> = []
  let wired = false

  async function start() {
    if (wired) return
    wired = true

    const logger = useNventLogger('trigger-wiring')
    const eventBus = getEventBus()
    const trigger = useTrigger()

    // Initialize trigger runtime
    await trigger.initialize()

    logger.info('Setting up trigger event wiring')

    // Listen to trigger.fired events
    unsubs.push(eventBus.onType('trigger.fired', async (event: EventRecord) => {
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
    }))

    // Listen to trigger.registered events - register triggers via useTrigger
    unsubs.push(eventBus.onType('trigger.registered', async (event: EventRecord) => {
      try {
        const triggerData = event.data as any
        await trigger.registerTrigger({
          name: triggerData.name,
          type: triggerData.type,
          scope: triggerData.scope,
          displayName: triggerData.displayName,
          description: triggerData.description,
          source: triggerData.source || 'build-time',
          expectedSubscribers: triggerData.expectedSubscribers,
          webhook: triggerData.webhook,
          schedule: triggerData.schedule,
          config: triggerData.config,
        })
        logger.debug(`Registered trigger: ${triggerData.name}`)
      }
      catch (error) {
        logger.error('Failed to register trigger', {
          trigger: (event.data as any)?.name,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }))

    // Listen to subscription.registered events - subscribe flows to triggers
    unsubs.push(eventBus.onType('subscription.registered', async (event: EventRecord) => {
      try {
        const subData = event.data as any
        await trigger.subscribeTrigger({
          trigger: subData.trigger,
          flow: subData.flow,
          mode: subData.mode || 'auto',
        })
        logger.debug(`Subscribed flow '${subData.flow}' to trigger '${subData.trigger}'`)
      }
      catch (error) {
        logger.error('Failed to subscribe flow to trigger', {
          data: event.data,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }))

    // Listen to await.registered events
    unsubs.push(eventBus.onType('await.registered', async (event: EventRecord) => {
      try {
        await handleAwaitRegistered(event as unknown as AwaitRegisteredEvent)
      }
      catch (error) {
        logger.error('Error handling await.registered event', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }))

    // Listen to await.resolved events
    unsubs.push(eventBus.onType('await.resolved', async (event: EventRecord) => {
      try {
        await handleAwaitResolved(event as unknown as AwaitResolvedEvent)
      }
      catch (error) {
        logger.error('Error handling await.resolved event', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }))

    // Listen to await.timeout events
    unsubs.push(eventBus.onType('await.timeout', async (event: EventRecord) => {
      const { SubjectPatterns } = useStreamTopics()
      const store = useStoreAdapter()
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
    }))

    logger.info('Trigger event wiring setup complete')
  }

  function stop() {
    const logger = useNventLogger('trigger-wiring')

    for (const u of unsubs.splice(0)) {
      try {
        u()
      }
      catch {
        // ignore
      }
    }

    wired = false
    logger.debug('Trigger wiring stopped')
  }

  return { start, stop }
}

/**
 * Handle trigger.fired event
 * Starts all subscribed flows (auto mode) or queues them (manual mode)
 */
export async function handleTriggerFired(event: TriggerFiredEvent) {
  const logger = useNventLogger('trigger-wiring')
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
 * Handle await.registered event
 * Sets up the await listener for the specific trigger pattern and stores state
 */
async function handleAwaitRegistered(event: AwaitRegisteredEvent) {
  const logger = useNventLogger('await-wiring')
  const store = useStoreAdapter()
  const { SubjectPatterns } = useStreamTopics()

  const { runId, stepName, flowName, awaitType, position, config: awaitConfig } = event
  const eventRecord = event as any // Access additional data fields

  logger.debug('Await pattern registered', {
    runId,
    stepName,
    awaitType,
    position,
  })

  // Store await state in flow run index metadata
  const indexKey = SubjectPatterns.flowRunIndex(flowName)
  if (store.indexUpdateWithRetry) {
    await store.indexUpdateWithRetry(indexKey, runId, {
      [`awaitingSteps.${stepName}`]: {
        awaitType,
        registeredAt: eventRecord.data?.registeredAt || Date.now(),
        position,
        webhookUrl: eventRecord.data?.webhookUrl,
        timeoutAt: eventRecord.data?.timeoutAt,
        blockedEmits: eventRecord.data?.blockedEmits,
      },
    })
  }

  // Store await registration in dedicated stream
  const awaitStreamName = SubjectPatterns.awaitTrigger(runId, stepName)
  await store.append(awaitStreamName, {
    type: 'await.registered',
    flowName,
    runId,
    stepName,
    data: {
      awaitType,
      awaitConfig,
      position,
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
  const store = useStoreAdapter()
  const { SubjectPatterns } = useStreamTopics()
  const { runId, stepName, triggerData: resolvedData } = event
  const flowName = event.flowName

  // Get await state from flow run index metadata
  const indexKey = SubjectPatterns.flowRunIndex(flowName)
  let awaitState: any = null
  if (store.indexGet) {
    const flowEntry = await store.indexGet(indexKey, runId)
    awaitState = flowEntry?.metadata?.awaitingSteps?.[stepName]
  }

  // Call lifecycle hook
  const hookRegistry = useHookRegistry()
  const hooks = hookRegistry.load(flowName, stepName)
  if (hooks?.onAwaitResolve) {
    try {
      await hooks.onAwaitResolve(
        resolvedData,
        { runId, stepName },
        useRunContext({ flowId: runId, flowName, stepName }),
      )
    }
    catch (err) {
      logger.error('onAwaitResolve hook failed', { error: (err as Error).message })
      // Continue with await resolution
    }
  }

  if (awaitState?.position === 'before') {
    // AWAIT BEFORE: Re-queue step to execute handler
    logger.info('Await before resolved, re-queuing step', { runId, stepName })
    await resumeStepAfterAwait(runId, stepName, resolvedData)
  }
  else if (awaitState?.position === 'after') {
    // AWAIT AFTER: Release blocked emits
    logger.info('Await after resolved, releasing blocked emits', { runId, stepName })

    const blockedEmits = awaitState?.blockedEmits
    if (blockedEmits && Array.isArray(blockedEmits) && blockedEmits.length > 0) {
      // Replay emits to trigger dependent steps
      const eventBus = getEventBus()
      for (const emitEvent of blockedEmits) {
        logger.debug('Replaying blocked emit', {
          runId,
          stepName,
          emitName: emitEvent.data?.name,
        })
        await eventBus.publish(emitEvent)
      }

      // Trigger pending steps (now that emits are available)
      await checkAndTriggerPendingSteps(flowName, runId, store)
    }
  }

  // Clean up await state from flow run index metadata
  if (store.indexUpdateWithRetry) {
    await store.indexUpdateWithRetry(indexKey, runId, {
      [`awaitingSteps.${stepName}`]: undefined,
    })
  }

  logger.debug('Await pattern resolved', {
    runId,
    stepName,
    position: awaitState?.position,
  })
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
