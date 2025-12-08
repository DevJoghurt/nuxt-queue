import type { EventRecord } from '../../adapters/interfaces/store'
import type { AwaitRegisteredEvent, AwaitResolvedEvent } from '../types'
import { getEventBus } from '../eventBus'
import { useNventLogger, useStoreAdapter, useQueueAdapter, $useAnalyzedFlows, $useFunctionRegistry, useStreamTopics, useRuntimeConfig, useScheduler } from '#imports'
import { createStallDetector } from '../utils/stallDetector'
import { SYSTEM_HANDLERS } from '../../worker/system'

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
    if (!store.index.get) {
      logger.info('No indexGet method on store', { flowName })
      return
    }
    const flowEntry = await store.index.get(indexKey, runId)
    if (!flowEntry?.metadata) {
      logger.info('No flow entry or metadata found', { flowName, runId })
      return
    }

    // Read all events to get completed steps
    const streamName = StoreSubjects.flowRun(runId)
    const allEvents = await store.stream.read(streamName)

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

      // Check await state using composite key for awaitBefore
      const awaitBeforeKey = `${stepName}:before`
      const awaitState = flowEntry?.metadata?.awaitingSteps?.[awaitBeforeKey]
      if (awaitState && awaitState.status === 'awaiting') continue
      if (awaitState && awaitState.status === 'timeout') continue

      // Check if any dependency steps are currently awaiting (awaitAfter pattern)
      // If a step has awaitAfter, its emits should be blocked until await is resolved
      const isDependencyAwaiting = step.subscribes.some((sub: string) => {
        const emitEvent = allEvents.find((evt: any) =>
          evt.type === 'emit' && evt.data?.name === sub,
        )
        if (!emitEvent) return false

        const emitStepName = emitEvent.stepName

        if (!emitStepName) {
          return false
        }

        // Check if the emitting step is awaiting (awaitAfter) using composite key
        const awaitAfterKey = `${emitStepName}:after`
        const awaitState = awaitingSteps[awaitAfterKey]

        // Block if dependency is awaiting after completion
        if (awaitState?.status === 'awaiting') {
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

        // Fallback: Check if emitting step has awaitAfter that hasn't resolved
        if (emittingStepMeta?.awaitAfter) {
          const stepCompleted = allEvents.some((evt: any) =>
            evt.type === 'step.completed' && evt.stepName === emitStepName,
          )
          if (stepCompleted) {
            const awaitResolved = allEvents.some((evt: any) =>
              evt.type === 'await.resolved'
              && evt.stepName === emitStepName
              && evt.position === 'after',
            )
            if (!awaitResolved) return true
          }
        }

        return false
      })

      if (isDependencyAwaiting) continue

      // Check if all dependencies are now satisfied
      const canTrigger = checkPendingStepTriggers(step, emittedEvents, completedSteps)

      // awaitBefore: Register await pattern before step executes
      if (canTrigger && step.awaitBefore) {
        // If awaiting, skip this step for now
        if (awaitState?.status === 'awaiting') continue

        // If not yet registered (undefined or other status), register it
        if (awaitState?.status !== 'resolved') {
          // First time dependencies satisfied - register await pattern
          try {
            // Collect emit data from dependencies
            const emitData: Record<string, any> = {}
            const subscribes = step.subscribes || []

            for (const sub of subscribes) {
              const emitEvent = allEvents.find((evt: any) =>
                evt.type === 'emit' && (evt.data as any)?.name === sub,
              ) as EventRecord | undefined

              if (emitEvent && (emitEvent.data as any)?.payload !== undefined) {
                emitData[sub] = (emitEvent.data as any).payload
              }
            }

            const payload = {
              flowId: runId,
              flowName,
              stepName,
              position: 'before' as const,
              awaitConfig: step.awaitBefore,
              input: emitData,
            }

            const jobId = `${runId}__${stepName}__await-register-before`

            // Get the step's queue from registry
            const flowRegistry = (registry?.flows || {})[flowName]
            const stepMeta = flowRegistry?.steps?.[stepName]
            let stepQueue = stepMeta?.queue

            // Check if this is the entry step
            if (!stepQueue && flowRegistry?.entry?.step === stepName) {
              stepQueue = flowRegistry.entry.queue
            }

            // Fallback: search all workers for this flow+step combination
            if (!stepQueue && registry?.workers) {
              const worker = (registry.workers as any[]).find((w: any) => {
                const flowNames = w?.flow?.names || (w?.flow?.name ? [w?.flow?.name] : [])
                const stepMatch = w?.flow?.step === stepName || (Array.isArray(w?.flow?.step) && w?.flow?.step.includes(stepName))
                return flowNames.includes(flowName) && stepMatch
              })
              stepQueue = worker?.queue?.name
            }

            if (!stepQueue) {
              logger.error('Cannot find queue for step', {
                stepName,
                flowName,
                availableSteps: Object.keys(flowRegistry?.steps || {}),
                entryStep: flowRegistry?.entry?.step,
              })
              throw new Error(`Cannot register await: queue not found for step ${stepName} in flow ${flowName}`)
            }

            // System handlers execute user-defined lifecycle hooks, so they need timeout
            // Use the same stepTimeout as the step itself since they're part of the step lifecycle
            const analyzedAwaitStep = (flowDef.analyzed?.steps || {})[stepName]
            const awaitStepTimeout = analyzedAwaitStep?.stepTimeout

            await queue.enqueue(stepQueue, {
              name: SYSTEM_HANDLERS.AWAIT_REGISTER,
              data: payload,
              opts: { jobId, timeout: awaitStepTimeout },
            })
          }
          catch (err) {
            logger.error('Failed to register awaitBefore pattern', {
              flowName,
              stepName,
              error: (err as Error).message,
            })
          }

          continue
        }
        // If awaitBefore is resolved, fall through to enqueue the step
      }

      // Only enqueue step if:
      // 1. Dependencies are satisfied (canTrigger)
      // 2. Either no awaitBefore, OR awaitBefore is resolved
      const shouldEnqueueStep = canTrigger && (!step.awaitBefore || awaitState?.status === 'resolved')

      if (shouldEnqueueStep) {
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
          const isAwaitResuming = awaitState?.status === 'resolved' && awaitState?.position === 'before'
          if (isAwaitResuming) {
            payload.awaitResolved = true
            payload.awaitData = awaitState.triggerData
            payload.awaitPosition = 'before' // Tell runner this is resuming from awaitBefore
          }

          // Use different jobId when resuming after awaitBefore to bypass idempotency
          const jobId = isAwaitResuming
            ? `${runId}__${stepName}__resumed`
            : `${runId}__${stepName}`

          // Get default job options from registry worker config (includes attempts config)
          // Find the worker for this step to get its queue.defaultJobOptions
          const worker = (registry?.workers as any[])?.find((w: any) =>
            w?.flow?.step === stepName && w?.queue?.name === stepMeta.queue,
          )
          const defaultOpts = worker?.queue?.defaultJobOptions || {}

          // Get stepTimeout from analyzed flow metadata (calculated during flow analysis)
          const analyzedStep = (flowDef.analyzed?.steps || {})[stepName]
          const stepTimeout = analyzedStep?.stepTimeout

          const opts = { ...defaultOpts, jobId, timeout: stepTimeout }

          try {
            await queue.enqueue(stepMeta.queue, { name: stepName, data: payload, opts })
          }
          catch {
            // Ignore - likely already enqueued (idempotency)
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

  // Build a dependency graph to understand step relationships
  // Map each step to its dependencies (what it subscribes to) and dependents (what depends on it)
  const stepDependencies = new Map<string, Set<string>>() // step -> its dependencies
  const stepDependents = new Map<string, Set<string>>() // step -> steps that depend on it

  // Initialize maps for all steps
  for (const stepName of allSteps) {
    stepDependencies.set(stepName, new Set())
    stepDependents.set(stepName, new Set())
  }

  // Build dependency relationships
  for (const [stepName, stepDef] of Object.entries(flowSteps)) {
    const step = stepDef as any
    const subscribes = step.subscribes || []

    for (const sub of subscribes) {
      // Find which step emits this event
      for (const [emitStepName, emitStepDef] of Object.entries(flowSteps)) {
        const emitStep = emitStepDef as any
        const emits = emitStep.emits || []

        // Check if this emit matches the subscription
        if (emits.some((emit: string) => sub === `${emitStepName}.${emit}` || sub === emit)) {
          stepDependencies.get(stepName)?.add(emitStepName)
          stepDependents.get(emitStepName)?.add(stepName)
        }
      }

      // Also check entry step
      if (entryStep && entryStepDef?.emits) {
        const entryEmits = entryStepDef.emits || []
        if (entryEmits.some((emit: string) => sub === `${entryStep}.${emit}` || sub === emit)) {
          stepDependencies.get(stepName)?.add(entryStep)
          stepDependents.get(entryStep)?.add(stepName)
        }
      }
    }
  }

  // Check if any failed step blocks the flow from completing
  // A failed step blocks the flow if:
  // 1. It has downstream dependents that haven't completed (blocking failure)
  // 2. OR it's in a "layer" where ALL siblings also failed (critical layer failure)
  let hasBlockingFailure = false
  let hasCriticalLayerFailure = false

  if (hasFinalFailures) {
    // Check for blocking failures (steps with incomplete dependents)
    for (const failedStepName of Array.from(finalFailedSteps)) {
      const dependents = stepDependents.get(failedStepName)

      if (dependents && dependents.size > 0) {
        // This step has dependents - check if any didn't complete
        for (const dependentName of Array.from(dependents)) {
          if (!completedSteps.has(dependentName)) {
            hasBlockingFailure = true
            break
          }
        }
      }

      if (hasBlockingFailure) break
    }

    // Check for critical layer failures (all siblings at same level failed)
    // Group steps by their dependency set (siblings have same dependencies)
    const layerGroups = new Map<string, Set<string>>()

    for (const stepName of allSteps) {
      const deps = stepDependencies.get(stepName)
      const depsKey = Array.from(deps || []).sort().join(',')

      if (!layerGroups.has(depsKey)) {
        layerGroups.set(depsKey, new Set())
      }
      layerGroups.get(depsKey)?.add(stepName)
    }

    // For each layer, check if ALL steps failed
    for (const [_depsKey, layerSteps] of Array.from(layerGroups)) {
      // Skip if this layer has no failures
      const layerHasFailures = Array.from(layerSteps).some(s => finalFailedSteps.has(s))
      if (!layerHasFailures) continue

      // Check if ALL steps in this layer failed (not just failed OR didn't run)
      // We only care about actual failures, not steps that didn't run because dependencies weren't met
      const allLayerStepsFailed = Array.from(layerSteps).every(s =>
        finalFailedSteps.has(s),
      )

      // Only mark as critical layer failure if ALL siblings actually failed
      // If at least one sibling succeeded, the parallel branch is OK
      if (allLayerStepsFailed) {
        const hasLeafNode = Array.from(layerSteps).some((s) => {
          const deps = stepDependents.get(s)
          return !deps || deps.size === 0
        })

        if (hasLeafNode) {
          hasCriticalLayerFailure = true
          break
        }
      }
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

  // Flow fails if:
  // 1. There's a blocking failure (step with incomplete dependents failed)
  // 2. OR there's a critical layer failure (all siblings at final layer failed)
  if (hasBlockingFailure || hasCriticalLayerFailure) {
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
  // Parallel branch failures are OK as long as at least one sibling succeeded
  const allStepsTerminal = allSteps.every(step =>
    completedSteps.has(step) || finalFailedSteps.has(step),
  )

  let status: 'running' | 'completed' | 'failed' | 'canceled' | 'awaiting' = 'running'

  // Flow is completed if all steps reached terminal state without critical failures
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
 * Lean Flow Wiring
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

      if (!store.index.add) {
        throw new Error('StoreAdapter does not support indexAdd')
      }
      await store.index.add(indexKey, flowId, timestamp, metadata)
    }
    catch (err) {
      logger.error('Failed to index run', { error: err })
    }
  }

  // Sequential event processing per flow run
  // Ensures emit tracking completes before orchestration reads the index
  // Each flow's events are processed in order, while different flows run in parallel
  const flowProcessingChain = new Map<string, Promise<void>>()

  // Track cleanup timers for graceful shutdown
  const cleanupTimers = new Map<string, NodeJS.Timeout>()

  async function start() {
    if (wired) return
    wired = true
    const logger = useNventLogger('flow-wiring')
    const { StoreSubjects } = useStreamTopics()

    logger.info('Flow wiring starting')

    // ============================================================================
    // HORIZONTAL SCALING NOTES:
    // ============================================================================
    // The current implementation processes events sequentially within each instance.
    // BullMQ naturally distributes flows across instances - workers on any instance
    // can pick up jobs. Each instance processes events locally and sequentially
    // per flow, while different flows run in parallel.
    //
    // Sequential processing per flow ensures:
    // - Emit tracking completes before orchestration reads metadata
    // - No race conditions in Redis optimistic locking retries
    // - Proper ordering of events within each flow
    //
    // No sticky sessions or distributed coordination needed - BullMQ handles
    // work distribution, and Redis provides shared state persistence.
    // ============================================================================

    // Get store - must be available after adapters are initialized
    const store = useStoreAdapter()

    if (!store || !store.stream.append) {
      logger.error('StoreAdapter not properly initialized or missing append method', {
        hasStore: !!store,
        hasAppend: !!(store && store.stream.append),
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
        const persistedEvent = await store.stream.append(streamName, eventData)

        // Republish complete event to bus so other wirings can react
        // StreamWiring listens for persisted events (id+ts) and publishes to UI
        await bus.publish(persistedEvent as any)

        if (e.type === 'flow.completed' || e.type === 'flow.failed') {
          // Unschedule ALL flow-related scheduled jobs (stall timeout + await timeouts)
          try {
            const scheduler = useScheduler()

            // Query persisted jobs by runId pattern (efficient, works across instances)
            const flowJobs = await scheduler.getJobsByPattern(runId)

            // Unschedule all matching jobs
            for (const job of flowJobs) {
              await scheduler.unschedule(job.id)
              logger.debug(`Unscheduled job for ${e.type} flow: ${job.id}`)
            }

            logger.debug(`Unscheduled ${flowJobs.length} scheduled jobs for ${e.type} flow runId '${runId}'`, {
              jobs: flowJobs.map(j => j.id),
            })
          }
          catch (error) {
            // Job may not exist or already fired - this is fine
            logger.debug(`Could not unschedule jobs for runId '${runId}'`, {
              error: (error as Error).message,
            })
          }

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
          if (store.index.increment) {
            await store.index.increment(flowIndexKey, flowName, 'stats.total', 1)
            await store.index.increment(flowIndexKey, flowName, 'stats.running', 1)
          }

          if (store.index.updateWithRetry) {
            await store.index.updateWithRetry(flowIndexKey, flowName, {
              lastRunAt: new Date().toISOString(),
            })
          }

          logger.debug('Updated flow stats for start', { flowName })
        }
        else if (e.type === 'flow.completed') {
          if (store.index.increment) {
            await store.index.increment(flowIndexKey, flowName, 'stats.running', -1)
            await store.index.increment(flowIndexKey, flowName, 'stats.success', 1)
          }

          if (store.index.updateWithRetry) {
            await store.index.updateWithRetry(flowIndexKey, flowName, {
              lastCompletedAt: new Date().toISOString(),
            })
          }

          logger.debug('Updated flow stats for completion', { flowName })
        }
        else if (e.type === 'flow.failed') {
          if (store.index.increment) {
            await store.index.increment(flowIndexKey, flowName, 'stats.running', -1)
            await store.index.increment(flowIndexKey, flowName, 'stats.failure', 1)
          }

          if (store.index.updateWithRetry) {
            await store.index.updateWithRetry(flowIndexKey, flowName, {
              lastCompletedAt: new Date().toISOString(),
            })
          }

          logger.debug('Updated flow stats for failure', { flowName })
        }
        else if (e.type === 'flow.cancel') {
          // Decrement the correct counter based on previous status
          if (store.index.increment) {
            const previousStatus = e.data?.previousStatus
            if (previousStatus === 'awaiting') {
              await store.index.increment(flowIndexKey, flowName, 'stats.awaiting', -1)
            }
            else {
              // Default to running if previousStatus not available
              await store.index.increment(flowIndexKey, flowName, 'stats.running', -1)
            }
            await store.index.increment(flowIndexKey, flowName, 'stats.cancel', 1)
          }

          if (store.index.updateWithRetry) {
            await store.index.updateWithRetry(flowIndexKey, flowName, {
              lastCompletedAt: new Date().toISOString(),
            })
          }

          logger.debug('Updated flow stats for cancellation', { flowName, previousStatus: e.data?.previousStatus })
        }
        else if (e.type === 'flow.stalled') {
          // Flow detected as stalled - decrement the correct counter based on previous status
          // Note: We don't increment failure count as this is a detection event, not a terminal state
          if (store.index.increment && e.data?.previousStatus) {
            if (e.data.previousStatus === 'awaiting') {
              await store.index.increment(flowIndexKey, flowName, 'stats.awaiting', -1)
              logger.debug('Updated flow stats for stalled detection (was awaiting)', { flowName })
            }
            else if (e.data.previousStatus === 'running') {
              await store.index.increment(flowIndexKey, flowName, 'stats.running', -1)
              logger.debug('Updated flow stats for stalled detection (was running)', { flowName })
            }
          }
        }
        else if (e.type === 'await.registered') {
          // Flow enters awaiting state - decrement running, increment awaiting
          if (store.index.increment) {
            await store.index.increment(flowIndexKey, flowName, 'stats.running', -1)
            await store.index.increment(flowIndexKey, flowName, 'stats.awaiting', 1)
          }

          logger.debug('Updated flow stats for await registered', { flowName })
        }
        else if (e.type === 'await.resolved' || e.type === 'await.timeout') {
          // Flow leaves awaiting state - decrement awaiting, increment running
          // (timeout will be handled by flow.failed event for terminal stats)
          if (store.index.increment) {
            await store.index.increment(flowIndexKey, flowName, 'stats.awaiting', -1)
            await store.index.increment(flowIndexKey, flowName, 'stats.running', 1)
          }

          logger.debug('Updated flow stats for await resolved/timeout', { flowName, type: e.type })
        }

        // Publish stats update event to internal bus so streamWiring can send it to clients
        try {
          const indexEntry = await store.index.get(flowIndexKey, flowName)
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
        // Only log if it's not an "Entry not found" error (which is expected for new flows)
        const errorMsg = (err as any)?.message || ''
        if (!errorMsg.includes('Entry not found')) {
          logger.warn('Failed to update flow stats', {
            type: e.type,
            flowName: e.flowName,
            error: errorMsg,
          })
        }
        else {
          logger.debug('Flow entry not found (will be created)', {
            type: e.type,
            flowName: e.flowName,
          })
        }
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

          // Schedule per-flow stall timeout job
          try {
            // Get stallTimeout from analyzed flows
            const analyzedFlows = $useAnalyzedFlows() as any[]
            const flowMeta = analyzedFlows.find((f: any) => f.id === flowName)
            const stallTimeout = flowMeta?.analyzed?.stallTimeout || (30 * 60 * 1000)

            const scheduler = useScheduler()
            const stallJobId = `stall-timeout:${runId}`

            await scheduler.schedule({
              id: stallJobId,
              name: `Stall Timeout - ${flowName}`,
              type: 'one-time',
              executeAt: timestamp + stallTimeout,
              handler: async () => {
                // Mark this specific flow as stalled
                if (stallDetector) {
                  logger.info(`Per-flow stall timeout fired for '${flowName}' runId '${runId}'`)
                  await stallDetector.markAsStalled(flowName, runId, 'Stall timeout reached')
                }
              },
              metadata: {
                component: 'stall-detector',
                flowName,
                runId,
              },
            })

            logger.debug(`Scheduled stall timeout for flow '${flowName}' runId '${runId}' in ${stallTimeout / 1000}s`, { jobId: stallJobId })
          }
          catch (error) {
            logger.warn(`Failed to schedule stall timeout for flow '${flowName}' runId '${runId}'`, {
              error: (error as Error).message,
            })
          }
        }

        // For flow.cancel, update status to canceled
        if (e.type === 'flow.cancel') {
          try {
            if (store.index.updateWithRetry) {
              await store.index.updateWithRetry(indexKey, runId, {
                status: 'canceled',
                completedAt: Date.now(),
              })

              logger.info('Marked flow as canceled', { flowName, runId })
            }

            // Unschedule ALL flow-related scheduled jobs (stall timeout + await timeouts)
            const scheduler = useScheduler()

            // Query persisted jobs by runId pattern (efficient, works across instances)
            const flowJobs = await scheduler.getJobsByPattern(runId)

            // Unschedule all matching jobs
            for (const job of flowJobs) {
              await scheduler.unschedule(job.id)
              logger.debug(`Unscheduled job for canceled flow: ${job.id}`)
            }

            logger.debug(`Unscheduled ${flowJobs.length} scheduled jobs for canceled flow runId '${runId}'`, {
              jobs: flowJobs.map(j => j.id),
            })
          }
          catch (err) {
            logger.warn('Failed to update canceled status or unschedule flow jobs', {
              flowName,
              runId,
              error: (err as any)?.message,
            })
          }
        }

        // For step events, reschedule stall timeout (extend deadline)
        if (e.type === 'step.started' || e.type === 'step.completed' || e.type === 'step.failed' || e.type === 'step.retry') {
          try {
            const scheduler = useScheduler()
            const stallJobId = `stall-timeout:${runId}`

            // Get flow-specific stall timeout
            const analyzedFlows = $useAnalyzedFlows() as any[]
            const flowMeta = analyzedFlows.find((f: any) => f.id === flowName)
            const stallTimeout = flowMeta?.analyzed?.stallTimeout || (30 * 60 * 1000)

            // Reschedule by canceling and creating new job with extended deadline
            await scheduler.unschedule(stallJobId)
            await scheduler.schedule({
              id: stallJobId,
              name: `Stall Timeout - ${flowName}`,
              type: 'one-time',
              executeAt: Date.now() + stallTimeout,
              handler: async () => {
                if (stallDetector) {
                  logger.info(`Per-flow stall timeout fired for '${flowName}' runId '${runId}'`)
                  await stallDetector.markAsStalled(flowName, runId, 'Stall timeout reached')
                }
              },
              metadata: {
                component: 'stall-detector',
                flowName,
                runId,
                stallTimeout,
              },
            })

            logger.debug(`Rescheduled stall timeout for flow '${flowName}' runId '${runId}' (activity: ${e.type})`)
          }
          catch (error) {
            // Job may not exist (already completed) or scheduler not available - log but don't fail
            logger.debug(`Could not reschedule stall timeout for flow '${flowName}' runId '${runId}'`, {
              error: (error as Error).message,
            })
          }
        }

        // For step.completed events, increment completedSteps counter
        if (e.type === 'step.completed') {
          try {
            // Use atomic increment to avoid race conditions in parallel steps
            if (store.index.increment) {
              const newCount = await store.index.increment(indexKey, runId, 'completedSteps', 1)

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
            if (store.index.updateWithRetry) {
              // Check if flow is already canceled before updating status
              if (store.index.get) {
                const currentEntry = await store.index.get(indexKey, runId)
                const currentStatus = (currentEntry?.metadata as any)?.status
                if (currentStatus === 'canceled') {
                  logger.debug('Flow already canceled, skipping await registration', { flowName, runId, stepName })
                  return // Don't register await for canceled flow
                }
              }

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

              // Use composite key: stepName:position to support both awaitBefore and awaitAfter
              const awaitKey = `${stepName}:${position}`

              const updatePayload = {
                status: 'awaiting', // Set flow status to awaiting
                awaitingSteps: {
                  [awaitKey]: {
                    status: 'awaiting',
                    stepName, // Keep stepName for queries
                    awaitType,
                    position,
                    config,
                    registeredAt: now,
                    timeoutAt,
                  },
                },
              }

              await store.index.updateWithRetry(indexKey, runId, updatePayload)

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
            // Check if flow is already canceled before resuming
            if (store.index.get) {
              const currentEntry = await store.index.get(indexKey, runId)
              const currentStatus = (currentEntry?.metadata as any)?.status
              if (currentStatus === 'canceled') {
                logger.debug('Flow already canceled, skipping await resolution', { flowName, runId, stepName })
                return // Don't resume canceled flow
              }
            }

            if (store.index.updateWithRetry) {
              // Use composite key: stepName:position to support both awaitBefore and awaitAfter
              const awaitKey = `${stepName}:${position}`

              await store.index.updateWithRetry(indexKey, runId, {
                awaitingSteps: {
                  [awaitKey]: {
                    status: 'resolved',
                    stepName, // Keep stepName for queries
                    triggerData,
                    position,
                  },
                },
              })
            }

            // Enqueue system handler to process await resolution
            const queue = useQueueAdapter()

            // Get input data from the flow state
            const { StoreSubjects } = useStreamTopics()
            const streamName = StoreSubjects.flowRun(runId)
            const inputData: any = {}

            if (store.stream.read) {
              const events = await store.stream.read(streamName, { limit: 100 })
              const registry = $useFunctionRegistry() as any
              const flowRegistry = (registry?.flows || {})[flowName]
              const stepMeta = flowRegistry?.steps?.[stepName]
              const subscribes = stepMeta?.subscribes || []

              for (const sub of subscribes) {
                const emitEvent = events.find((evt: any) =>
                  evt.type === 'emit' && (evt.data as any)?.name === sub,
                )
                if (emitEvent && (emitEvent.data as any)?.payload !== undefined) {
                  inputData[sub] = (emitEvent.data as any).payload
                }
              }
            }

            const { SYSTEM_HANDLERS } = await import('../../worker/system')

            const payload = {
              flowId: runId,
              flowName,
              stepName,
              position,
              triggerData,
              input: inputData,
            }

            const jobId = `${runId}__${stepName}__await-resolve`

            // Get the step's queue from registry
            const registry = $useFunctionRegistry() as any
            const flowRegistry = (registry?.flows || {})[flowName]
            const stepMeta = flowRegistry?.steps?.[stepName]
            let stepQueue = stepMeta?.queue

            // Check if this is the entry step
            if (!stepQueue && flowRegistry?.entry?.step === stepName) {
              stepQueue = flowRegistry.entry.queue
            }

            // Fallback: search all workers for this flow+step combination
            if (!stepQueue && registry?.workers) {
              const worker = (registry.workers as any[]).find((w: any) => {
                const flowNames = w?.flow?.names || (w?.flow?.name ? [w?.flow?.name] : [])
                const stepMatch = w?.flow?.step === stepName || (Array.isArray(w?.flow?.step) && w?.flow?.step.includes(stepName))
                return flowNames.includes(flowName) && stepMatch
              })
              stepQueue = worker?.queue?.name
            }

            if (!stepQueue) {
              logger.error('Cannot find queue for step', {
                stepName,
                flowName,
                availableSteps: Object.keys(flowRegistry?.steps || {}),
                entryStep: flowRegistry?.entry?.step,
              })
              throw new Error(`Cannot resolve await: queue not found for step ${stepName} in flow ${flowName}`)
            }

            await queue.enqueue(stepQueue, {
              name: SYSTEM_HANDLERS.AWAIT_RESOLVE,
              data: payload,
              opts: { jobId },
            })

            // Trigger orchestration to check pending steps
            // For awaitBefore: check if this step can now be enqueued
            // For awaitAfter: check if dependent steps can now be triggered
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

          // Check if flow is already canceled before processing timeout
          if (store.index.get) {
            const currentEntry = await store.index.get(indexKey, runId)
            const currentStatus = (currentEntry?.metadata as any)?.status
            if (currentStatus === 'canceled') {
              logger.debug('Flow already canceled, skipping await timeout handling', { flowName, runId, stepName })
              return // Don't process timeout for canceled flow
            }
          }

          logger.warn('Await timeout occurred', {
            runId,
            stepName,
            awaitType,
            position,
            action,
          })

          try {
            // Enqueue system handler to process await timeout
            const queue = useQueueAdapter()

            // Get input data from the flow state
            const { StoreSubjects } = useStreamTopics()
            const streamName = StoreSubjects.flowRun(runId)
            const inputData: any = {}

            if (store.stream.read) {
              const events = await store.stream.read(streamName, { limit: 100 })
              const registry = $useFunctionRegistry() as any
              const flowRegistry = (registry?.flows || {})[flowName]
              const stepMeta = flowRegistry?.steps?.[stepName]
              const subscribes = stepMeta?.subscribes || []

              for (const sub of subscribes) {
                const emitEvent = events.find((evt: any) =>
                  evt.type === 'emit' && (evt.data as any)?.name === sub,
                )
                if (emitEvent && (emitEvent.data as any)?.payload !== undefined) {
                  inputData[sub] = (emitEvent.data as any).payload
                }
              }
            }

            const payload = {
              flowId: runId,
              flowName,
              stepName,
              position,
              timeoutAction: action,
              input: inputData,
            }

            const jobId = `${runId}__${stepName}__await-timeout`

            // Get the step's queue from registry
            const registry = $useFunctionRegistry() as any
            const flowRegistry = (registry?.flows || {})[flowName]
            const stepMeta = flowRegistry?.steps?.[stepName]
            let stepQueue = stepMeta?.queue

            // Check if this is the entry step
            if (!stepQueue && flowRegistry?.entry?.step === stepName) {
              stepQueue = flowRegistry.entry.queue
            }

            // Fallback: search all workers for this flow+step combination
            if (!stepQueue && registry?.workers) {
              const worker = (registry.workers as any[]).find((w: any) => {
                const flowNames = w?.flow?.names || (w?.flow?.name ? [w?.flow?.name] : [])
                const stepMatch = w?.flow?.step === stepName || (Array.isArray(w?.flow?.step) && w?.flow?.step.includes(stepName))
                return flowNames.includes(flowName) && stepMatch
              })
              stepQueue = worker?.queue?.name
            }

            if (!stepQueue) {
              logger.error('Cannot find queue for step', {
                stepName,
                flowName,
                availableSteps: Object.keys(flowRegistry?.steps || {}),
                entryStep: flowRegistry?.entry?.step,
              })
              throw new Error(`Cannot handle await timeout: queue not found for step ${stepName} in flow ${flowName}`)
            }

            await queue.enqueue(stepQueue, {
              name: SYSTEM_HANDLERS.AWAIT_TIMEOUT,
              data: payload,
              opts: { jobId },
            })

            if (action === 'fail') {
              // Mark await as failed and fail the step/flow
              if (store.index.updateWithRetry) {
                await store.index.updateWithRetry(indexKey, runId, {
                  awaitingSteps: {
                    [stepName]: {
                      status: 'timeout',
                      timedOutAt: Date.now(),
                    },
                  },
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
              if (store.index.updateWithRetry) {
                await store.index.updateWithRetry(indexKey, runId, {
                  awaitingSteps: {
                    [stepName]: {
                      status: 'resolved',
                      triggerData: null,
                      timedOutAt: Date.now(),
                    },
                  },
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
        if (e.type === 'emit') {
          // Emit events use 'name' field, not 'topic' - extract from data
          const eventName = (e.data as any)?.name || e.data?.topic

          if (!eventName) {
            logger.warn('Emit event missing name/topic', { flowName, runId, data: e.data })
          }
          else {
            try {
              if (!store.index.updateWithRetry) {
                logger.warn('StoreAdapter does not support indexUpdateWithRetry')
                return
              }

              // Store emitted events as a nested object structure
              // Split event name by dots to create proper nesting
              // e.g., 'approval.requested' → { approval: { requested: timestamp } }
              const timestamp = Date.now()

              // Build nested structure from dot-notated event name
              const eventParts = eventName.split('.')
              const emittedEventsUpdate: any = {}
              let current = emittedEventsUpdate

              for (let i = 0; i < eventParts.length - 1; i++) {
                current[eventParts[i]] = {}
                current = current[eventParts[i]]
              }
              current[eventParts[eventParts.length - 1]] = timestamp

              const updatePayload = {
                emittedEvents: emittedEventsUpdate,
              }

              await store.index.updateWithRetry(indexKey, runId, updatePayload)

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

        // For step.completed, trigger orchestration to check pending steps
        // IMPORTANT: Do NOT trigger orchestration on step.failed events!
        // - step.failed is emitted for EVERY failed attempt (including retries)
        // - If the step will retry, a step.retry event is also emitted
        // - The queue adapter (pg-boss/BullMQ) handles retries automatically
        // - Re-enqueueing on step.failed creates duplicate jobs and infinite loops
        // Only trigger orchestration when a step successfully completes
        if (e.type === 'step.completed') {
          // ORCHESTRATION: Check if any steps can now be triggered
          // This handles both emit events and step completions, so we only need to call it here
          try {
            await checkAndTriggerPendingSteps(flowName, runId, store)
          }
          catch (err) {
            logger.error('Error checking pending steps', {
              flowName,
              runId,
              error: (err as Error).message,
            })
            throw err
          }
        }
        // Check flow completion for both step.completed and step.failed
        if (e.type === 'step.completed' || e.type === 'step.failed') {
          try {
            // Read all events for this flow to analyze completion
            const allEvents = await store.stream.read(streamName)

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

              // IMPORTANT: Check current status and awaits before updating
              // Preserve 'canceled' status if already set (terminal state)
              if (store.index.get) {
                const currentEntry = await store.index.get(indexKey, runId)
                const currentStatus = (currentEntry?.metadata as any)?.status

                // If flow is already canceled, don't overwrite with non-terminal status
                // This prevents race conditions when canceling from within a step
                if (currentStatus === 'canceled') {
                  logger.debug('Flow already canceled, skipping status update', { flowName, runId })
                  return // Exit early, don't update status
                }

                // Check for active or timed-out awaits
                const awaitingStepsObj = (currentEntry?.metadata as any)?.awaitingSteps || {}

                let hasActiveAwaits = false
                let hasTimedOutAwaits = false

                for (const [_stepName, awaitState] of Object.entries(awaitingStepsObj)) {
                  if ((awaitState as any)?.status === 'awaiting') {
                    hasActiveAwaits = true
                  }
                  else if ((awaitState as any)?.status === 'timeout') {
                    hasTimedOutAwaits = true
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
              if (store.index.updateWithRetry) {
                await store.index.updateWithRetry(indexKey, runId, updateMetadata)
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
                if (store.index.get) {
                  const currentEntry = await store.index.get(indexKey, runId)
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

    // Subscribe to event types with handlers
    // Sequential processing wrapper: Ensures events for the same flow are processed in order
    // Different flows process in parallel, preventing cross-flow blocking
    const processEventSequentially = async (event: EventRecord) => {
      const runId = event.runId
      if (!runId) {
        // No runId - process immediately (shouldn't happen for flow events)
        await handlePersistence(event)
        await handleOrchestration(event)
        await handleFlowStats(event)
        return
      }

      // Chain this event after the previous event for this flow
      const previousProcessing = flowProcessingChain.get(runId) || Promise.resolve()

      const currentProcessing = previousProcessing.then(async () => {
        try {
          // Process handlers in order: Persistence → Orchestration → Stats
          await handlePersistence(event)
          await handleOrchestration(event)
          await handleFlowStats(event)
        }
        catch (err) {
          logger.error('Error in sequential event processing', {
            runId,
            type: event.type,
            error: (err as Error).message,
            stack: (err as Error).stack,
          })
          // Don't rethrow - allow other events to process
        }
        finally {
          // Clean up completed chains after a delay to prevent memory leak
          // Cancel any existing cleanup timer for this flow
          const existingTimer = cleanupTimers.get(runId)
          if (existingTimer) {
            clearTimeout(existingTimer)
          }

          // Schedule new cleanup after 60s of inactivity
          const timer = setTimeout(() => {
            if (flowProcessingChain.get(runId) === currentProcessing) {
              flowProcessingChain.delete(runId)
              cleanupTimers.delete(runId)
            }
          }, 60000)
          cleanupTimers.set(runId, timer)
        }
      })

      flowProcessingChain.set(runId, currentProcessing)
      return currentProcessing
    }

    const eventTypes = [
      'flow.start', 'flow.completed', 'flow.failed', 'flow.cancel',
      'step.started', 'step.completed', 'step.failed', 'step.retry',
      'await.registered', 'await.resolved', 'await.timeout',
      'log', 'emit', 'state',
    ]

    // Register sequential processing wrapper for all flow event types
    for (const type of eventTypes) {
      unsubs.push(bus.onType(type, processEventSequentially))
    }

    // Initialize and start stall detector
    // Note: Stall detection now uses per-flow scheduler jobs (scheduled on flow.start)
    // No periodic background job needed
    const config = useRuntimeConfig()
    const flowConfig = (config as any).nvent.flow || {}
    stallDetector = createStallDetector(store, flowConfig.stallDetection)
    if (flowConfig.stallDetection?.enabled !== false) {
      await stallDetector.start()
      logger.info('Stall detector initialized - using per-flow scheduler jobs')
    }
  }

  async function stop() {
    const logger = useNventLogger('flow-wiring')

    // Stop stall detector first (async to properly unschedule)
    if (stallDetector) {
      try {
        await stallDetector.stop()
        stallDetector = undefined
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

    // Clear cleanup timers
    for (const timer of cleanupTimers.values()) {
      clearTimeout(timer)
    }
    cleanupTimers.clear()

    // Clear flow processing chains
    flowProcessingChain.clear()

    wired = false
  }

  return { start, stop }
}
