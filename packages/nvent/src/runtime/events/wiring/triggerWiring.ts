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
    // v0.5.1: Now appends flow start results to trigger stream
    unsubs.push(eventBus.onType('trigger.fired', async (event: EventRecord) => {
      try {
        const triggerName = (event as any).triggerName || (event.data as any)?.triggerName
        const flowsStarted = await handleTriggerFired(event as unknown as TriggerFiredEvent)

        // Append metadata about flow starts to trigger stream
        const { SubjectPatterns } = useStreamTopics()
        const store = useStoreAdapter()
        const streamName = SubjectPatterns.trigger(triggerName)

        if (flowsStarted.length > 0) {
          await store.append(streamName, {
            type: 'trigger.processed',
            triggerName,
            data: {
              flowsStarted,
              subscribersNotified: flowsStarted.length,
              processedAt: Date.now(),
            },
          })
        }
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

    // ============================================================================
    // HANDLER 1: PERSISTENCE - Store await events to streams
    // ============================================================================
    const handleAwaitPersistence = async (e: EventRecord) => {
      try {
        // Only process ingress events (not already persisted)
        if (e.id && e.ts) {
          return
        }

        const { runId, stepName } = e
        if (!runId || !stepName) {
          return
        }

        const { SubjectPatterns } = useStreamTopics()
        const store = useStoreAdapter()
        const flowStreamName = SubjectPatterns.flowRun(runId)

        // Store in flow run stream
        const persistedEvent = await store.append(flowStreamName, e)

        // Republish to bus so flowWiring can update the index
        await eventBus.publish(persistedEvent as any)

        logger.debug(`Stored ${e.type} in flow stream`, { runId, stepName })
      }
      catch (err) {
        logger.error(`Error persisting ${e.type} event`, {
          error: (err as any)?.message,
        })
      }
    }

    // ============================================================================
    // HANDLER 2: ORCHESTRATION - Handle await lifecycle (timeouts, resume steps)
    // ============================================================================
    const handleAwaitOrchestration = async (e: EventRecord) => {
      try {
        // Only process ingress events
        if (e.id && e.ts) {
          return
        }

        if (e.type === 'await.registered') {
          await handleAwaitRegisteredOrchestration(e as unknown as AwaitRegisteredEvent)
        }
        else if (e.type === 'await.resolved') {
          await handleAwaitResolvedOrchestration(e as unknown as AwaitResolvedEvent)
        }
      }
      catch (error) {
        logger.error(`Error in await orchestration for ${e.type}`, {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // Listen to await.registered events - persistence first, then orchestration
    unsubs.push(eventBus.onType('await.registered', handleAwaitPersistence))
    unsubs.push(eventBus.onType('await.registered', handleAwaitOrchestration))

    // Listen to await.resolved events - persistence first, then orchestration
    unsubs.push(eventBus.onType('await.resolved', handleAwaitPersistence))
    unsubs.push(eventBus.onType('await.resolved', handleAwaitOrchestration))

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
 * Returns list of flows that were started for stream metadata
 */
export async function handleTriggerFired(event: TriggerFiredEvent): Promise<string[]> {
  const logger = useNventLogger('trigger-wiring')
  const trigger = useTrigger()

  const { triggerName, data } = event

  logger.debug('Trigger fired', { trigger: triggerName })

  // Get all subscribed flows
  const subscriptions = trigger.getAllSubscriptions()
    .filter(sub => sub.triggerName === triggerName)

  if (subscriptions.length === 0) {
    logger.warn(`No flows subscribed to trigger: ${triggerName}`)
    return []
  }

  const flowsStarted: string[] = []

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
      flowsStarted.push(subscription.flowName)
    }
    catch (error) {
      logger.error('Error starting flow from trigger', {
        flow: subscription.flowName,
        trigger: triggerName,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return flowsStarted
}

/**
 * Start a flow from a trigger event
 * Enqueues the entry step and publishes flow.start event
 */
export async function startFlowFromTrigger(
  flowName: string,
  triggerName: string,
  triggerData: any,
) {
  const logger = useNventLogger('trigger-wiring')
  const eventBus = getEventBus()
  const queue = useQueueAdapter()
  const registry = $useQueueRegistry() as any
  const analyzedFlows = $useAnalyzedFlows()

  // Verify flow exists
  const flowDef = analyzedFlows.find((f: any) => f.id === flowName) as any
  if (!flowDef || !flowDef.entry) {
    logger.error(`Flow '${flowName}' not found or has no entry point`)
    return
  }

  // Get flow registry for entry step details
  const flowRegistry = (registry?.flows || {})[flowName]
  if (!flowRegistry?.entry) {
    logger.error(`Flow '${flowName}' has no entry in registry`)
    return
  }

  // Generate run ID
  const runId = `${flowName}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`

  logger.info(`Starting flow '${flowName}' from trigger '${triggerName}'`, { runId })

  // Get queue name and step name from entry
  const queueName = flowRegistry.entry.queue
  const stepName = flowRegistry.entry.step

  // Build entry step payload
  const payload = {
    flowId: runId,
    flowName,
    trigger: {
      name: triggerName,
      data: triggerData,
    },
    ...triggerData,
  }

  // Get default job options from entry worker config
  const entryWorker = (registry?.workers as any[])?.find((w: any) =>
    w?.flow?.step === stepName && w?.queue?.name === queueName,
  )
  const defaultOpts = entryWorker?.queue?.defaultJobOptions || {}
  const jobId = `${runId}__${stepName}`
  const opts = { ...defaultOpts, jobId }

  try {
    // Enqueue the entry step
    await queue.enqueue(queueName, {
      name: stepName,
      data: payload,
      opts,
    })

    logger.info(`Enqueued entry step '${stepName}' to queue '${queueName}'`, { runId })

    // Publish flow.start event for tracking
    await eventBus.publish({
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
  catch (error) {
    logger.error('Failed to start flow from trigger', {
      flowName,
      trigger: triggerName,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Handle await.registered orchestration
 * Sets up timeout tracking and updates flow index
 */
async function handleAwaitRegisteredOrchestration(event: AwaitRegisteredEvent) {
  const logger = useNventLogger('await-wiring')
  const store = useStoreAdapter()
  const { SubjectPatterns } = useStreamTopics()

  const { runId, stepName, awaitType, position, config: awaitConfig, flowName } = event

  logger.info('Flow status set to awaiting', { flowName, runId, stepName, awaitType })

  // Update flow index with await state
  const indexKey = SubjectPatterns.flowRunIndex(flowName)
  const registeredAt = Date.now()
  const timeoutAt = awaitConfig.timeout ? registeredAt + (awaitConfig.timeout * 1000) : undefined

  if (store.indexUpdateWithRetry) {
    await store.indexUpdateWithRetry(indexKey, runId, {
      status: 'awaiting',
      [`awaitingSteps.${stepName}.awaitType`]: awaitType,
      [`awaitingSteps.${stepName}.registeredAt`]: registeredAt,
      [`awaitingSteps.${stepName}.position`]: position,
      [`awaitingSteps.${stepName}.status`]: 'awaiting',
      [`awaitingSteps.${stepName}.webhookUrl`]: awaitConfig.webhookUrl,
      [`awaitingSteps.${stepName}.timeoutAt`]: timeoutAt,
      [`awaitingSteps.${stepName}.timeoutAction`]: awaitConfig.timeoutAction || 'fail',
    })
  }
}

/**
 * Handle await.resolved orchestration
 * Updates flow index and resumes paused steps or triggers blocked dependent steps
 */
async function handleAwaitResolvedOrchestration(event: AwaitResolvedEvent) {
  const logger = useNventLogger('await-wiring')
  const store = useStoreAdapter()
  const { SubjectPatterns } = useStreamTopics()
  const { runId, stepName, triggerData: resolvedData } = event
  const flowName = event.flowName

  logger.info('Flow status set back to running', { flowName, runId, stepName })

  // Update flow index - mark await as resolved and set status back to running
  // Use atomic dot notation updates
  const indexKey = SubjectPatterns.flowRunIndex(flowName)
  if (store.indexUpdateWithRetry) {
    await store.indexUpdateWithRetry(indexKey, runId, {
      status: 'running',
      [`awaitingSteps.${stepName}.resolvedAt`]: Date.now(),
      [`awaitingSteps.${stepName}.status`]: 'resolved',
    })
  }

  // Get await state for position check
  let awaitState: any = null
  if (store.indexGet) {
    const flowEntry = await store.indexGet(indexKey, runId)
    // Access nested structure (not flattened)
    const metadata = flowEntry?.metadata as any
    awaitState = metadata?.awaitingSteps?.[stepName]
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
  else if (awaitState?.position === 'after' || event.position === 'after') {
    // AWAIT AFTER: Check and trigger any steps that were blocked
    logger.info('Await after resolved, checking for blocked steps', { runId, stepName })

    // Always check for pending steps after await resolves
    // The blocking logic in checkAndTriggerPendingSteps will see that await.resolved exists
    // and will allow previously blocked steps to trigger
    await checkAndTriggerPendingSteps(flowName, runId, store)
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
