import type { EventRecord } from '../../adapters/interfaces/store'
import type { AwaitRegisteredEvent, AwaitResolvedEvent } from '../types'
import { getEventBus } from '../eventBus'
import { useNventLogger, useStoreAdapter, useQueueAdapter, $useAnalyzedFlows, $useFunctionRegistry, useStreamTopics, useRuntimeConfig, useScheduler } from '#imports'
import { createStallDetector } from '../utils/stallDetector'

/**
 * Check if all dependencies for a step are met
 * Returns true if all subscriptions have been emitted or completed
 */
export function checkPendingStepTriggers(
  step: any,
  emittedEvents: Set<string>,
  completedSteps: Set<string>,
): boolean {
  if (!step.subscribes || step.subscribes.length === 0) {
    return true // No dependencies
  }

  return step.subscribes.every((sub: string) => {
    // Check if event was emitted
    if (emittedEvents.has(sub)) return true

    // Parse subscription to check step-based dependencies (step:stepName)
    const [prefix, value] = sub.split(':')
    if (prefix === 'step' && value) {
      return completedSteps.has(value)
    }

    return false
  })
}

/**
 * Check all steps in the flow and trigger any that now have all dependencies satisfied
 * This is called after emit events and step completions
 */
export async function checkAndTriggerPendingSteps(
  flowName: string,
  runId: string,
  store: ReturnType<typeof useStoreAdapter>,
): Promise<void> {
  const logger = useNventLogger('flow-wiring')
  try {
    const analyzedFlows = $useAnalyzedFlows()
    const registry = $useFunctionRegistry() as any
    const queue = useQueueAdapter()
    const { StoreSubjects } = useStreamTopics()

    // Get flow definition
    const flowDef = analyzedFlows.find((f: any) => f.id === flowName) as any
    if (!flowDef?.steps) {
      logger.info('No flow definition or steps found', { flowName })
      return
    }

    // Get current flow metadata
    const indexKey = StoreSubjects.flowRunIndex(flowName)
    if (!store.indexGet) {
      logger.info('No indexGet method on store', { flowName })
      return
    }
    const flowEntry = await store.indexGet(indexKey, runId)
    if (!flowEntry?.metadata) {
      logger.info('No flow entry or metadata found', { flowName, runId })
      return
    }

    // Read all events to get completed steps
    const streamName = StoreSubjects.flowRun(runId)
    const allEvents = await store.read(streamName)

    // Check if flow is canceled - if so, don't trigger any new steps
    const isCanceled = allEvents.some((event: any) => event.type === 'flow.cancel')
    if (isCanceled) {
      logger.debug('Flow is canceled, skipping pending step triggers', { flowName, runId })
      return
    }

    // Build sets of completed events and steps
    // emittedEvents is stored as nested object: { eventName: { subEvent: timestamp } }
    // We need to flatten to dot notation: 'eventName.subEvent'
    const emittedEventsObj = flowEntry.metadata.emittedEvents || {}

    const flattenEmittedEvents = (obj: any, prefix = ''): string[] => {
      const result: string[] = []
      for (const [key, value] of Object.entries(obj)) {
        if (key === 'undefined' || key === 'null') continue

        const fullKey = prefix ? `${prefix}.${key}` : key

        if (value && typeof value === 'object' && !Array.isArray(value)) {
          // Recursively flatten nested objects
          result.push(...flattenEmittedEvents(value, fullKey))
        }
        else {
          // Leaf node - add the full dot notation path
          result.push(fullKey)
        }
      }
      return result
    }

    const emittedEvents = new Set<string>(
      typeof emittedEventsObj === 'object' && !Array.isArray(emittedEventsObj)
        ? flattenEmittedEvents(emittedEventsObj)
        : Array.isArray(emittedEventsObj) ? emittedEventsObj : [],
    )

    const completedSteps = new Set<string>()
    for (const event of allEvents) {
      if (event.type === 'step.completed' && 'stepName' in event) {
        completedSteps.add((event as any).stepName)
      }
    }

    // Get awaiting steps from flow metadata
    const awaitingSteps = flowEntry?.metadata?.awaitingSteps || {}

    // Check all steps in the flow to see if any can now be triggered
    for (const [stepName, stepDef] of Object.entries(flowDef.steps)) {
      const step = stepDef as any

      // Skip if step doesn't have dependencies or already completed
      if (!step.subscribes || completedSteps.has(stepName)) continue

      // v0.5: Check await state - skip if step is currently awaiting (not resolved)
      const awaitState = flowEntry?.metadata?.awaitingSteps?.[stepName]
      if (awaitState && awaitState.status === 'awaiting') {
        logger.debug('Step is awaiting, skipping trigger', {
          flowName,
          runId,
          stepName,
          awaitType: awaitState.awaitType,
          position: awaitState.position,
          status: awaitState.status,
        })
        continue
      }

      // Skip if await has timed out - step should not be retried
      if (awaitState && awaitState.status === 'timeout') {
        logger.debug('Step await timed out, skipping trigger', {
          flowName,
          runId,
          stepName,
          awaitType: awaitState.awaitType,
        })
        continue
      }

      // If await is resolved, allow the step to proceed
      if (awaitState?.status === 'resolved') {
        logger.debug('Step await is resolved, will proceed', {
          flowName,
          runId,
          stepName,
          awaitType: awaitState.awaitType,
          position: awaitState.position,
        })
      }

      // v0.5: Check if any dependency steps are currently awaiting (awaitAfter pattern)
      // If a step has awaitAfter, its emits should be blocked until await is resolved
      const isDependencyAwaiting = step.subscribes.some((sub: string) => {
        // Find which step emitted this event by looking through all events
        const emitEvent = allEvents.find((evt: any) =>
          evt.type === 'emit' && evt.data?.name === sub,
        )

        if (!emitEvent) {
          return false // Emit hasn't happened yet
        }

        const emitStepName = emitEvent.stepName

        if (!emitStepName) {
          return false
        }

        // Check if the emitting step is awaiting in flow index metadata
        const awaitState = awaitingSteps[emitStepName]

        // If the step is awaiting after completion, its emits are blocked
        // BUT: Only block if status is 'awaiting', not if it's 'resolved'
        if (awaitState?.position === 'after' && awaitState?.status === 'awaiting') {
          return true
        }

        // If await is resolved, do NOT block
        if (awaitState?.status === 'resolved') {
          return false
        }

        // FALLBACK: Check if the emitting step has awaitAfter config
        // This covers the race condition where await.registered hasn't been processed yet
        let emittingStepMeta = flowDef.steps[emitStepName]

        // Check entry step if not in steps object
        if (!emittingStepMeta && emitStepName === (flowDef as any).entry?.step) {
          emittingStepMeta = (flowDef as any).entry
        }

        // If the step has awaitAfter, check if await cycle is complete
        if (emittingStepMeta?.awaitAfter) {
          // Check if this step has completed
          const stepCompleted = allEvents.some((evt: any) =>
            evt.type === 'step.completed' && evt.stepName === emitStepName,
          )

          if (stepCompleted) {
            // Check if await has been resolved
            const awaitResolved = allEvents.some((evt: any) =>
              evt.type === 'await.resolved' && evt.stepName === emitStepName,
            )

            // Block if await hasn't resolved yet
            if (!awaitResolved) {
              return true
            }
          }
        }

        return false
      })

      if (isDependencyAwaiting) {
        continue
      }

      // Check if all dependencies are now satisfied
      const canTrigger = checkPendingStepTriggers(step, emittedEvents, completedSteps)

      if (canTrigger) {
        // Find the queue for this step from registry
        const flowRegistry = (registry?.flows || {})[flowName]
        const stepMeta = flowRegistry?.steps?.[stepName]

        if (stepMeta?.queue) {
          // Collect emit data from all subscribed events
          const emitData: Record<string, any> = {}
          const subscribes = step.subscribes || []

          for (const sub of subscribes) {
            // Find the emit event for this subscription
            const emitEvent = allEvents.find((evt: any) =>
              evt.type === 'emit' && (evt.data as any)?.name === sub,
            ) as EventRecord | undefined

            if (emitEvent && (emitEvent.data as any)?.payload !== undefined) {
              emitData[sub] = (emitEvent.data as any).payload
            }
          }

          // Build payload with emit data for non-entry steps
          const payload: any = {
            flowId: runId,
            flowName,
            input: emitData, // Keyed by event name
          }

          // If step had awaitBefore that's now resolved, include await data and mark as resolved
          if (awaitState?.status === 'resolved' && awaitState?.position === 'before') {
            payload.awaitResolved = true
            payload.awaitData = awaitState.triggerData
          }

          const jobId = `${runId}__${stepName}`

          // Get default job options from registry worker config (includes attempts config)
          // Find the worker for this step to get its queue.defaultJobOptions
          const worker = (registry?.workers as any[])?.find((w: any) =>
            w?.flow?.step === stepName && w?.queue?.name === stepMeta.queue,
          )
          const defaultOpts = worker?.queue?.defaultJobOptions || {}
          const opts = { ...defaultOpts, jobId }

          try {
            await queue.enqueue(stepMeta.queue, { name: stepName, data: payload, opts })

            logger.debug('Enqueued pending step', {
              flowName,
              runId,
              step: stepName,
            })
          }
          catch {
            // Already enqueued - idempotency working correctly
          }
        }
      }
    }
  }
  catch (err) {
    logger.warn('Failed to check pending steps', {
      flowName,
      runId,
      error: (err as any)?.message,
    })
  }
}

/**
 * Analyze flow completion status from events
 * Returns status, step counts, and timestamps
 */
export function analyzeFlowCompletion(
  flowSteps: Record<string, any>,
  entryStep: string | undefined,
  events: any[],
  entryStepDef?: any, // Entry step definition (contains emits, etc.)
): {
  status: 'running' | 'completed' | 'failed' | 'canceled' | 'awaiting'
  totalSteps: number
  completedSteps: number
  startedAt: number
  completedAt: number
} {
  // Check if flow is canceled
  const isCanceled = events.some((event: any) => event.type === 'flow.cancel')

  // Include entry step in the list of all steps
  const allSteps = entryStep
    ? [entryStep, ...Object.keys(flowSteps)]
    : Object.keys(flowSteps)

  const completedSteps = new Set<string>()
  const failedSteps = new Set<string>()
  const retriedSteps = new Map<string, number>() // Track retry attempts
  let startedAt = 0
  let completedAt = 0

  for (const event of events) {
    if (event.type === 'flow.start') {
      startedAt = typeof event.ts === 'string' ? new Date(event.ts).getTime() : 0
    }
    if (event.type === 'flow.cancel') {
      completedAt = typeof event.ts === 'string' ? new Date(event.ts).getTime() : Date.now()
    }
    if (event.type === 'step.completed' && 'stepName' in event) {
      completedSteps.add(event.stepName)
    }
    if (event.type === 'step.retry' && 'stepName' in event) {
      // Track retry attempts to distinguish from final failures
      const currentAttempts = retriedSteps.get(event.stepName) || 0
      retriedSteps.set(event.stepName, currentAttempts + 1)
    }
    if (event.type === 'step.failed' && 'stepName' in event) {
      // Only count as failed if this is NOT followed by a retry
      // We'll check this after processing all events
      failedSteps.add(event.stepName)
    }
  }

  // Remove steps from failedSteps if they were retried (not final failure)
  // A step is only permanently failed if it has a step.failed event but no subsequent retry
  const finalFailedSteps = new Set<string>()
  for (const stepName of Array.from(failedSteps)) {
    // Check if there was a step.failed event after the last step.retry
    let lastRetryIndex = -1
    let lastFailedIndex = -1

    for (let i = 0; i < events.length; i++) {
      const event = events[i]
      if ('stepName' in event && event.stepName === stepName) {
        if (event.type === 'step.retry') {
          lastRetryIndex = i
        }
        if (event.type === 'step.failed') {
          lastFailedIndex = i
        }
      }
    }

    // If the last failed event is after the last retry, it's a final failure
    if (lastFailedIndex > lastRetryIndex) {
      finalFailedSteps.add(stepName)
    }
  }

  const totalSteps = allSteps.length
  const hasFinalFailures = finalFailedSteps.size > 0

  // Check if any failed step blocks the flow from completing
  // A failed step blocks the flow if:
  // 1. It has emits that other steps depend on (those steps can never run)
  // 2. Other steps are waiting for those emits
  let hasBlockingFailure = false

  if (hasFinalFailures) {
    for (const failedStepName of Array.from(finalFailedSteps)) {
      // Get failed step definition - check both flowSteps and entry step
      let failedStepDef = flowSteps[failedStepName] as any

      // If the failed step is the entry step, use the entry step definition
      if (!failedStepDef && failedStepName === entryStep && entryStepDef) {
        failedStepDef = entryStepDef
      }

      // Check if this failed step has emits
      if (failedStepDef?.emits && failedStepDef.emits.length > 0) {
        // Check if any other step depends on these emits
        for (const [stepName, stepDef] of Object.entries(flowSteps)) {
          const step = stepDef as any

          // Skip the failed step itself
          if (stepName === failedStepName) continue

          // Check if this step subscribes to any of the failed step's emits
          if (step.subscribes && step.subscribes.length > 0) {
            const dependsOnFailedStep = step.subscribes.some((sub: string) => {
              // Check if subscription matches any emit from failed step
              // Emit names are typically "{stepName}.{eventName}"
              return failedStepDef.emits.some((emit: string) =>
                sub === `${failedStepName}.${emit}` || sub === emit,
              )
            })

            if (dependsOnFailedStep && !completedSteps.has(stepName)) {
              // This step depends on the failed step and hasn't completed
              // So the flow is blocked
              hasBlockingFailure = true
              break
            }
          }
        }
      }

      if (hasBlockingFailure) break
    }
  }

  // Flow is canceled if flow.cancel event exists
  if (isCanceled) {
    return {
      status: 'canceled',
      totalSteps,
      completedSteps: completedSteps.size,
      startedAt,
      completedAt,
    }
  }

  // Flow fails ONLY if there's a blocking failure
  // A blocking failure prevents the flow from completing
  if (hasBlockingFailure) {
    return {
      status: 'failed',
      totalSteps,
      completedSteps: completedSteps.size,
      startedAt,
      completedAt: Date.now(),
    }
  }

  // Flow completes when all steps have reached a terminal state
  // A step is in terminal state if it's: completed OR failed
  // Non-blocking failures (parallel/optional steps) are OK
  const allStepsTerminal = allSteps.every(step =>
    completedSteps.has(step) || finalFailedSteps.has(step),
  )

  let status: 'running' | 'completed' | 'failed' | 'canceled' | 'awaiting' = 'running'

  // Flow is completed if all steps have reached a terminal state
  // Since we already checked for blocking failures above, any remaining failures are non-blocking
  if (allStepsTerminal) {
    status = 'completed'
    completedAt = Date.now()
  }

  return {
    status,
    totalSteps,
    completedSteps: completedSteps.size,
    startedAt,
    completedAt,
  }
}

/**
 * v0.4 Lean Flow Wiring
 *
 * 1. Persists flow events to streams using runId
 * 2. Maintains a sorted set index using projection names for listing runs
 *
 * Events arrive as "ingress" (no id/ts) and are persisted to `nq:flow:{runId}` streams.
 */
export function createFlowWiring() {
  const bus = getEventBus()
  const unsubs: Array<() => void> = []
  let wired = false
  let stallDetector: ReturnType<typeof createStallDetector> | undefined

  // Track terminal events being published to prevent duplicates during race conditions
  const publishingTerminalEvents = new Set<string>()

  /**
   * Add flow run to sorted set index for listing
   */
  const indexFlowRun = async (flowName: string, flowId: string, timestamp: number, metadata?: Record<string, any>) => {
    const logger = useNventLogger('flow-wiring')
    try {
      const store = useStoreAdapter()
      const { StoreSubjects } = useStreamTopics()
      // Use centralized naming function
      const indexKey = StoreSubjects.flowRunIndex(flowName)

      if (!store.indexAdd) {
        throw new Error('StoreAdapter does not support indexAdd')
      }
      await store.indexAdd(indexKey, flowId, timestamp, metadata)

      logger.debug('Indexed run', { flowName, flowId, indexKey, timestamp, metadata })
    }
    catch (err) {
      logger.error('Failed to index run', { error: err })
    }
  }

  async function start() {
    if (wired) return
    wired = true
    const logger = useNventLogger('flow-wiring')
    const { StoreSubjects } = useStreamTopics()

    // Get store - must be available after adapters are initialized
    const store = useStoreAdapter()

    if (!store || !store.append) {
      logger.error('StoreAdapter not properly initialized or missing append method', {
        hasStore: !!store,
        hasAppend: !!(store && store.append),
      })
      throw new Error('StoreAdapter not initialized')
    }

    // ============================================================================
    // HANDLER 1: PERSISTENCE - Append all flow events to streams
    // ============================================================================
    const handlePersistence = async (e: EventRecord) => {
      try {
        // Only process ingress events (not already persisted)
        if (e.id && e.ts) {
          return
        }

        // v0.4: Get runId and flowName from event
        const runId = e.runId
        if (!runId) {
          return
        }

        const flowName = e.flowName
        if (!flowName) {
          return
        }

        // Use centralized naming function
        const streamName = StoreSubjects.flowRun(runId)

        // Validate event has required type field
        if (!e.type) {
          logger.error('Event missing type field', { event: e })
          return
        }

        const eventData: any = {
          type: e.type,
          runId: e.runId,
          flowName: e.flowName,
          data: e.data,
        }

        // Add step-specific fields if present
        if ('stepName' in e && (e as any).stepName) eventData.stepName = (e as any).stepName
        if ('stepId' in e && (e as any).stepId) eventData.stepId = (e as any).stepId
        if ('attempt' in e && (e as any).attempt) eventData.attempt = (e as any).attempt

        // Append to stream - returns complete event with id and ts
        const persistedEvent = await store.append(streamName, eventData)

        // Republish complete event to bus so other wirings can react
        // StreamWiring listens for persisted events (id+ts) and publishes to UI
        await bus.publish(persistedEvent as any)

        if (e.type === 'flow.completed' || e.type === 'flow.failed') {
          // Clean up the publishing tracker after a short delay to ensure
          // all concurrent orchestration handlers have finished their checks
          const publishKey = `${runId}:terminal`
          setTimeout(() => {
            try {
              publishingTerminalEvents.delete(publishKey)
            }
            catch (err) {
              // Ignore cleanup errors (shouldn't happen, but defensive)
              logger.debug('Error cleaning up terminal event tracker', { publishKey, error: (err as any)?.message })
            }
          }, 200)

          logger.info('Stored terminal event', {
            type: e.type,
            flowName,
            runId,
            id: persistedEvent.id,
          })
        }
        else {
          logger.debug('Stored event', {
            type: e.type,
            flowName,
            runId,
            stepName: 'stepName' in e ? e.stepName : undefined,
            id: persistedEvent.id,
          })
        }
      }
      catch (err) {
        logger.error('ERROR persisting event', {
          type: e.type,
          runId: e.runId,
          flowName: e.flowName,
          error: (err as any)?.message,
        })
      }
    }

    // ============================================================================
    // HANDLER 2: FLOW STATS - Update flow-level statistics from flow events
    // ============================================================================
    const handleFlowStats = async (e: EventRecord) => {
      try {
        // Only process persisted flow events
        if (!e.id || !e.ts) {
          return
        }

        const flowName = e.flowName
        if (!flowName) return

        const flowIndexKey = StoreSubjects.flowIndex()

        // Update flow index stats based on event type
        if (e.type === 'flow.start') {
          if (store.indexIncrement) {
            await store.indexIncrement(flowIndexKey, flowName, 'stats.total', 1)
            await store.indexIncrement(flowIndexKey, flowName, 'stats.running', 1)
          }

          if (store.indexUpdateWithRetry) {
            await store.indexUpdateWithRetry(flowIndexKey, flowName, {
              lastRunAt: new Date().toISOString(),
            })
          }

          logger.debug('Updated flow stats for start', { flowName })
        }
        else if (e.type === 'flow.completed') {
          if (store.indexIncrement) {
            await store.indexIncrement(flowIndexKey, flowName, 'stats.running', -1)
            await store.indexIncrement(flowIndexKey, flowName, 'stats.success', 1)
          }

          if (store.indexUpdateWithRetry) {
            await store.indexUpdateWithRetry(flowIndexKey, flowName, {
              lastCompletedAt: new Date().toISOString(),
            })
          }

          logger.debug('Updated flow stats for completion', { flowName })
        }
        else if (e.type === 'flow.failed') {
          if (store.indexIncrement) {
            await store.indexIncrement(flowIndexKey, flowName, 'stats.running', -1)
            await store.indexIncrement(flowIndexKey, flowName, 'stats.failure', 1)
          }

          if (store.indexUpdateWithRetry) {
            await store.indexUpdateWithRetry(flowIndexKey, flowName, {
              lastCompletedAt: new Date().toISOString(),
            })
          }

          logger.debug('Updated flow stats for failure', { flowName })
        }
        else if (e.type === 'flow.cancel') {
          if (store.indexIncrement) {
            await store.indexIncrement(flowIndexKey, flowName, 'stats.running', -1)
            await store.indexIncrement(flowIndexKey, flowName, 'stats.cancel', 1)
          }

          if (store.indexUpdateWithRetry) {
            await store.indexUpdateWithRetry(flowIndexKey, flowName, {
              lastCompletedAt: new Date().toISOString(),
            })
          }

          logger.debug('Updated flow stats for cancellation', { flowName })
        }
        else if (e.type === 'await.registered') {
          // Flow enters awaiting state - decrement running, increment awaiting
          if (store.indexIncrement) {
            await store.indexIncrement(flowIndexKey, flowName, 'stats.running', -1)
            await store.indexIncrement(flowIndexKey, flowName, 'stats.awaiting', 1)
          }

          logger.debug('Updated flow stats for await registered', { flowName })
        }
        else if (e.type === 'await.resolved' || e.type === 'await.timeout') {
          // Flow leaves awaiting state - decrement awaiting, increment running
          // (timeout will be handled by flow.failed event for terminal stats)
          if (store.indexIncrement) {
            await store.indexIncrement(flowIndexKey, flowName, 'stats.awaiting', -1)
            await store.indexIncrement(flowIndexKey, flowName, 'stats.running', 1)
          }

          logger.debug('Updated flow stats for await resolved/timeout', { flowName, type: e.type })
        }

        // Publish stats update event to internal bus so streamWiring can send it to clients
        try {
          const indexEntry = await store.indexGet(flowIndexKey, flowName)
          if (indexEntry) {
            await bus.publish({
              type: 'flow.stats.updated',
              flowName,
              id: indexEntry.id,
              metadata: indexEntry.metadata,
              ts: Date.now(),
            } as any)
            logger.debug('Published flow stats update event to bus', { flowName })
          }
        }
        catch (err) {
          logger.warn('Failed to publish flow stats update event', {
            flowName,
            error: (err as any)?.message,
          })
        }
      }
      catch (err) {
        logger.warn('Failed to update flow stats', {
          type: e.type,
          flowName: e.flowName,
          error: (err as any)?.message,
        })
      }
    }

    // ============================================================================
    // HANDLER 3: ORCHESTRATION - Update metadata, analyze completion, trigger events
    // ============================================================================
    const handleOrchestration = async (e: EventRecord) => {
      try {
        // Only process ingress events (not already persisted)
        if (e.id && e.ts) {
          return
        }

        // Don't process terminal events to avoid infinite loop
        // (we publish these events, so we shouldn't re-process them)
        if (e.type === 'flow.completed' || e.type === 'flow.failed') {
          return
        }

        const runId = e.runId
        if (!runId) return

        const flowName = e.flowName
        if (!flowName) return

        const streamName = StoreSubjects.flowRun(runId)
        const indexKey = StoreSubjects.flowRunIndex(flowName)

        // For flow.start, initialize index with running status
        if (e.type === 'flow.start') {
          const timestamp = Date.now()
          await indexFlowRun(flowName, runId, timestamp, {
            status: 'running',
            startedAt: timestamp,
            lastActivityAt: timestamp, // Initialize for stall detection
            stepCount: 0,
            completedSteps: 0,
            emittedEvents: {}, // Object for atomic updates
          })
        }

        // For flow.cancel, update status to canceled
        if (e.type === 'flow.cancel') {
          try {
            if (store.indexUpdateWithRetry) {
              await store.indexUpdateWithRetry(indexKey, runId, {
                status: 'canceled',
                completedAt: Date.now(),
              })

              logger.info('Marked flow as canceled', { flowName, runId })
            }
          }
          catch (err) {
            logger.warn('Failed to update canceled status', {
              flowName,
              runId,
              error: (err as any)?.message,
            })
          }
        }

        // For step events, update activity timestamp (stall detection)
        if (e.type === 'step.started' || e.type === 'step.completed' || e.type === 'step.failed' || e.type === 'step.retry') {
          if (stallDetector) {
            await stallDetector.updateActivity(flowName, runId)
          }
        }

        // For step.completed events, increment completedSteps counter
        if (e.type === 'step.completed') {
          try {
            // Use atomic increment to avoid race conditions in parallel steps
            if (store.indexIncrement) {
              const newCount = await store.indexIncrement(indexKey, runId, 'completedSteps', 1)

              logger.debug('Incremented completedSteps', {
                flowName,
                runId,
                stepName: 'stepName' in e ? e.stepName : 'unknown',
                newCount,
              })
            }
          }
          catch (err) {
            logger.warn('Failed to update completedSteps', {
              flowName,
              runId,
              error: (err as any)?.message,
            })
          }
        }

        // For await.registered events, update flow index with await status
        if (e.type === 'await.registered') {
          const awaitEvent = e as unknown as AwaitRegisteredEvent
          const { stepName, awaitType, position, config } = awaitEvent

          try {
            if (store.indexUpdateWithRetry) {
              const now = Date.now()

              // Calculate timeoutAt based on await type and config
              let timeoutAt: number | undefined

              if (awaitType === 'time' && config.delay) {
                // For time awaits: current time + delay
                timeoutAt = now + config.delay
              }
              else if (awaitType === 'schedule' && config.nextOccurrence) {
                // For schedule awaits: next cron occurrence
                timeoutAt = config.nextOccurrence
              }
              else if (config.timeout) {
                // Generic timeout config
                timeoutAt = now + config.timeout
              }

              // If no specific timeout, use a default max await time (e.g., 24 hours)
              if (!timeoutAt) {
                timeoutAt = now + (24 * 60 * 60 * 1000) // 24 hours default
              }

              await store.indexUpdateWithRetry(indexKey, runId, {
                [`awaitingSteps.${stepName}.status`]: 'awaiting',
                [`awaitingSteps.${stepName}.awaitType`]: awaitType,
                [`awaitingSteps.${stepName}.position`]: position,
                [`awaitingSteps.${stepName}.config`]: config,
                [`awaitingSteps.${stepName}.registeredAt`]: now,
                [`awaitingSteps.${stepName}.timeoutAt`]: timeoutAt,
              })

              logger.info('Await registered in index', {
                runId,
                stepName,
                awaitType,
                position,
                timeoutAt: new Date(timeoutAt).toISOString(),
              })
            }
          }
          catch (err) {
            logger.error('Error updating await status', {
              runId,
              stepName,
              error: (err as any)?.message,
            })
          }
        }

        // For await.resolved events, update status and resume step
        if (e.type === 'await.resolved') {
          const awaitEvent = e as unknown as AwaitResolvedEvent
          const { stepName, triggerData, position } = awaitEvent

          try {
            if (store.indexUpdateWithRetry) {
              await store.indexUpdateWithRetry(indexKey, runId, {
                [`awaitingSteps.${stepName}.status`]: 'resolved',
                [`awaitingSteps.${stepName}.triggerData`]: triggerData,
              })

              logger.debug('Await resolved in index', { runId, stepName, position })
            }

            // Resume the step by checking pending steps
            // The step will be triggered if all its dependencies are now satisfied
            await checkAndTriggerPendingSteps(flowName, runId, store)
          }
          catch (err) {
            logger.error('Error handling await resolution', {
              runId,
              stepName,
              error: (err as any)?.message,
            })
          }
        }

        // For await.timeout events, handle based on timeoutAction
        if (e.type === 'await.timeout') {
          const timeoutEvent = e as any
          const { stepName, timeoutAction, position, awaitType } = timeoutEvent
          const action = timeoutAction || 'fail'

          logger.warn('Await timeout occurred', {
            runId,
            stepName,
            awaitType,
            position,
            action,
          })

          try {
            if (action === 'fail') {
              // Mark await as failed and fail the step/flow
              if (store.indexUpdateWithRetry) {
                await store.indexUpdateWithRetry(indexKey, runId, {
                  [`awaitingSteps.${stepName}.status`]: 'timeout',
                  [`awaitingSteps.${stepName}.timedOutAt`]: Date.now(),
                })
              }

              // Emit step.failed event
              // The flow completion logic will determine if the flow should fail
              bus.publish({
                type: 'step.failed',
                runId,
                flowName,
                stepName,
                stepId: `${runId}__${stepName}__timeout`,
                attempt: 1,
                data: {
                  error: `Await timeout: ${awaitType} await exceeded timeout`,
                },
              })
            }
            else if (action === 'continue') {
              // Mark as resolved with null data and continue
              if (store.indexUpdateWithRetry) {
                await store.indexUpdateWithRetry(indexKey, runId, {
                  [`awaitingSteps.${stepName}.status`]: 'resolved',
                  [`awaitingSteps.${stepName}.triggerData`]: null,
                  [`awaitingSteps.${stepName}.timedOutAt`]: Date.now(),
                })
              }

              logger.info('Await timeout - continuing with null data', { runId, stepName })

              // Resume the step
              await checkAndTriggerPendingSteps(flowName, runId, store)
            }
            // 'retry' action would need queue re-enqueueing logic - not implemented yet
          }
          catch (err) {
            logger.error('Error handling await timeout', {
              runId,
              stepName,
              error: (err as any)?.message,
            })
          }
        }

        // For emit events, track emitted events in metadata
        // Use Set-like structure with dot notation for atomic updates
        if (e.type === 'emit') {
          // Emit events use 'name' field, not 'topic' - extract from data
          const eventName = (e.data as any)?.name || e.data?.topic

          if (!eventName) {
            logger.warn('Emit event missing name/topic', { flowName, runId, data: e.data })
          }
          else {
            try {
              if (!store.indexUpdateWithRetry) {
                logger.warn('StoreAdapter does not support indexUpdateWithRetry')
                return
              }

              // Use dot notation to store emitted events as a set-like structure
              // emittedEvents.eventName: timestamp
              // This allows atomic updates without read-modify-write
              const timestamp = Date.now()
              await store.indexUpdateWithRetry(indexKey, runId, {
                [`emittedEvents.${eventName}`]: timestamp,
              })

              logger.debug('Tracked emit event', {
                flowName,
                runId,
                name: eventName,
                timestamp,
              })
            }
            catch (err) {
              logger.warn('Failed to track emitted event', {
                flowName,
                runId,
                event: eventName,
                error: (err as any)?.message,
              })
            }
          }
        }

        // For step.completed or step.failed, check if flow is complete
        // IMPORTANT: Do this AFTER incrementing completedSteps to avoid race condition
        if (e.type === 'step.completed' || e.type === 'step.failed') {
          // ORCHESTRATION: Check if any steps can now be triggered
          // This handles both emit events and step completions, so we only need to call it here
          await checkAndTriggerPendingSteps(flowName, runId, store)

          try {
            // Read all events for this flow to analyze completion
            const allEvents = await store.read(streamName)

            // Get analyzed flow definition from build-time analysis
            const analyzedFlows = $useAnalyzedFlows()
            const flowDef = analyzedFlows.find((f: any) => f.id === flowName)

            if (flowDef?.steps) {
              const entryStepName = (flowDef as any).entry?.step
              const entryStepDef = (flowDef as any).entry // Pass full entry definition
              const analysis = analyzeFlowCompletion(flowDef.steps, entryStepName, allEvents, entryStepDef)

              // Build update object, only include defined values
              const updateMetadata: Record<string, any> = {
                status: analysis.status,
                stepCount: analysis.totalSteps,
              }

              // Only add completedAt if flow is in terminal state
              if (analysis.status !== 'running' && analysis.completedAt) {
                updateMetadata.completedAt = analysis.completedAt
              }

              // IMPORTANT: Check if flow has active awaits before updating status
              // If there are awaits, preserve 'awaiting' status
              if (store.indexGet) {
                const currentEntry = await store.indexGet(indexKey, runId)

                // Check for active or timed-out awaits
                const awaitingStepsObj = (currentEntry?.metadata as any)?.awaitingSteps || {}

                let hasActiveAwaits = false
                let hasTimedOutAwaits = false

                for (const [stepName, awaitState] of Object.entries(awaitingStepsObj)) {
                  if ((awaitState as any)?.status === 'awaiting') {
                    hasActiveAwaits = true
                    logger.debug('Found active await', { stepName, awaitState })
                  }
                  else if ((awaitState as any)?.status === 'timeout') {
                    hasTimedOutAwaits = true
                    logger.debug('Found timed-out await', { stepName, awaitState })
                  }
                }

                // If there are active awaits, set status to 'awaiting'
                if (hasActiveAwaits) {
                  updateMetadata.status = 'awaiting'
                }

                // If any await timed out, mark flow as failed (timeout is a blocking failure)
                if (hasTimedOutAwaits) {
                  updateMetadata.status = 'failed'
                  if (!updateMetadata.completedAt) {
                    updateMetadata.completedAt = Date.now()
                  }
                }
              }

              // Update metadata with current state
              if (store.indexUpdateWithRetry) {
                await store.indexUpdateWithRetry(indexKey, runId, updateMetadata)
              }

              // Use the actual status from updateMetadata (which includes timeout overrides)
              // instead of analysis.status (which doesn't consider awaits)
              const finalStatus = updateMetadata.status || analysis.status

              // If flow reached terminal state, publish terminal event to bus
              // The persistence handler will store it, and other plugins can react to it
              if (finalStatus === 'completed' || finalStatus === 'failed') {
                const eventType = finalStatus === 'completed' ? 'flow.completed' : 'flow.failed'

                // Check flow metadata to see if we already published a terminal event
                // Re-read the index entry after update to get the current status
                let currentStatus = null
                if (store.indexGet) {
                  const currentEntry = await store.indexGet(indexKey, runId)
                  currentStatus = currentEntry?.metadata?.status
                }

                // Check if terminal event already exists in stream
                const terminalEventExists = allEvents.some((evt: any) =>
                  evt.type === 'flow.completed' || evt.type === 'flow.failed')

                // Check if we're already publishing a terminal event for this run (race condition prevention)
                const publishKey = `${runId}:terminal`
                const alreadyPublishing = publishingTerminalEvents.has(publishKey)

                if (terminalEventExists) {
                  logger.debug('Flow terminal event already exists in stream, skipping publish', {
                    flowName,
                    runId,
                    currentStatus,
                    eventType,
                  })
                }
                else if (alreadyPublishing) {
                  logger.debug('Flow terminal event already being published, skipping duplicate', {
                    flowName,
                    runId,
                    eventType,
                  })
                }
                else {
                  // Mark as publishing to prevent race conditions
                  publishingTerminalEvents.add(publishKey)

                  logger.info('Publishing terminal event to bus', {
                    flowName,
                    runId,
                    eventType,
                  })

                  // Publish to bus WITHOUT id/ts so it gets persisted by handlePersistence
                  // Flow stats will be updated by handleFlowStats when the persisted event is processed
                  // The publishingTerminalEvents entry will be cleaned up by handlePersistence after storage
                  await bus.publish({
                    type: eventType,
                    runId,
                    flowName,
                    data: {},
                  } as any)
                }
              }
            }
          }
          catch (err) {
            logger.warn('Failed to analyze flow completion', {
              flowName,
              runId,
              error: (err as any)?.message,
            })
          }
        }
      }
      catch (err) {
        logger.error('ERROR handling event', {
          type: e.type,
          runId: e.runId,
          flowName: e.flowName,
          error: (err as any)?.message,
        })
      }
    }

    // v0.4: Subscribe to event types with handlers
    // Order matters: Persistence runs first, then orchestration (creates indexes), then stats
    const eventTypes = [
      'flow.start', 'flow.completed', 'flow.failed', 'flow.cancel',
      'step.started', 'step.completed', 'step.failed', 'step.retry',
      'await.registered', 'await.resolved', 'await.timeout',
      'log', 'emit', 'state',
    ]

    const flowStatsEventTypes = ['flow.start', 'flow.completed', 'flow.failed', 'flow.cancel', 'await.registered', 'await.resolved', 'await.timeout']

    // Register persistence handler first (stores events)
    for (const type of eventTypes) {
      unsubs.push(bus.onType(type, handlePersistence))
    }

    // Register orchestration handler second (creates indexes, triggers new events)
    for (const type of eventTypes) {
      unsubs.push(bus.onType(type, handleOrchestration))
    }

    // Register flow stats handler third (updates flow-level stats after indexes exist)
    for (const type of flowStatsEventTypes) {
      unsubs.push(bus.onType(type, handleFlowStats))
    }

    // Initialize and start stall detector
    const config = useRuntimeConfig()
    const flowConfig = (config as any).nvent.flow || {}
    stallDetector = createStallDetector(store, flowConfig.stallDetection)
    if (flowConfig.stallDetection?.enabled) {
      await stallDetector.start()

      // Schedule the periodic check job HERE in flowWiring (not in the class)
      // This ensures the handler closure has the correct context
      const scheduleConfig = stallDetector.getScheduleConfig()
      if (scheduleConfig.enabled) {
        try {
          const scheduler = useScheduler()

          logger.info('Scheduling periodic stall detector from flowWiring', {
            checkInterval: `${scheduleConfig.interval / 1000}s`,
          })

          const jobId = await scheduler.schedule({
            id: 'stall-detection',
            name: 'Flow Stall Detection',
            type: 'interval',
            interval: scheduleConfig.interval,
            handler: async () => {
              // Guard: Check if detector still exists (shutdown scenario)
              if (!stallDetector || !wired) {
                logger.debug('Stall detector handler called but wiring stopped')
                return
              }

              try {
                logger.info('Stall detector running periodic check')
                // Get flow names and call the detector's check method
                const analyzedFlows = $useAnalyzedFlows() as any[]
                const flowNames = analyzedFlows.map((f: any) => f.id).filter(Boolean)

                if (flowNames.length > 0) {
                  await stallDetector.checkFlowsForStalls(flowNames)
                }
              }
              catch (error) {
                logger.error('Stall detector periodic check failed', {
                  error: (error as Error).message,
                  stack: (error as Error).stack,
                })
                // Don't rethrow - let scheduler continue on next interval
              }
            },
            metadata: {
              component: 'stall-detector',
              stallTimeout: scheduleConfig.stallTimeout,
              checkInterval: scheduleConfig.interval,
            },
          })

          stallDetector.setSchedulerJobId(jobId)
          logger.info('Stall detector started and scheduled', { jobId })
        }
        catch (error) {
          logger.error('Failed to schedule stall detector - periodic checks disabled', {
            error: (error as Error).message,
            stack: (error as Error).stack,
          })
          // Detector still runs startup recovery and lazy detection
        }
      }
      else {
        logger.info('Stall detector started (periodic check disabled)')
      }
    }
  }

  async function stop() {
    const logger = useNventLogger('flow-wiring')

    // Stop stall detector first (async to properly unschedule)
    if (stallDetector) {
      try {
        await stallDetector.stop()
        stallDetector = undefined
        logger.debug('Stall detector stopped')
      }
      catch (error) {
        logger.error('Error stopping stall detector', {
          error: (error as Error).message,
        })
      }
    }

    for (const u of unsubs.splice(0)) {
      try {
        u()
      }
      catch {
        // ignore
      }
    }

    // Clear the terminal event tracking set to prevent memory leaks
    publishingTerminalEvents.clear()

    wired = false

    logger.debug('Flow wiring stopped')
  }

  return { start, stop }
}
