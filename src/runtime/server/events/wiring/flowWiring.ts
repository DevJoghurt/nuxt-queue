import type { EventStoreAdapter } from '../types'
import type { EventRecord, EmitEvent } from '../../../types'
import { getEventBus } from '../eventBus'
import { useEventStore, $useAnalyzedFlows, $useQueueRegistry, useQueue } from '#imports'

export interface FlowWiringDeps {
  adapter: EventStoreAdapter
}

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
async function checkAndTriggerPendingSteps(
  flowName: string,
  runId: string,
  store: ReturnType<typeof useEventStore>,
): Promise<void> {
  try {
    const analyzedFlows = $useAnalyzedFlows()
    const registry = $useQueueRegistry() as any
    const { enqueue } = useQueue()

    // Get flow definition
    const flowDef = analyzedFlows.find((f: any) => f.id === flowName) as any
    if (!flowDef?.steps) return

    // Get current flow metadata
    const indexKey = store.names().flowIndex(flowName)
    const flowEntry = await store.indexGet(indexKey, runId)
    if (!flowEntry?.metadata) return

    // Build sets of completed events and steps
    const emittedEvents = new Set<string>(flowEntry.metadata.emittedEvents || [])

    // Read all events to get completed steps
    const streamName = store.names().flow(runId)
    const allEvents = await store.read(streamName)

    const completedSteps = new Set<string>()
    for (const event of allEvents) {
      if (event.type === 'step.completed' && 'stepName' in event) {
        completedSteps.add((event as any).stepName)
      }
    }

    // Check all steps in the flow to see if any can now be triggered
    for (const [stepName, stepDef] of Object.entries(flowDef.steps)) {
      const step = stepDef as any

      // Skip if step doesn't have dependencies or already completed
      if (!step.subscribes || completedSteps.has(stepName)) continue

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
            const emitEvent = allEvents.find((evt: EventRecord) =>
              evt.type === 'emit' && (evt.data as any)?.name === sub,
            )

            if (emitEvent && (emitEvent.data as any)?.payload !== undefined) {
              emitData[sub] = (emitEvent.data as any).payload
            }
          }

          // Build payload with emit data for non-entry steps
          const payload = {
            flowId: runId,
            flowName,
            input: emitData, // Keyed by event name
          }
          const jobId = `${runId}__${stepName}`

          try {
            await enqueue(stepMeta.queue, { name: stepName, data: payload, opts: { jobId } })

            console.log('[flow-wiring] triggered pending step:', {
              flowName,
              runId,
              step: stepName,
              subscribes: step.subscribes,
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
    console.warn('[flow-wiring] failed to check pending steps:', {
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
  events: EventRecord[],
): {
  status: 'running' | 'completed' | 'failed'
  totalSteps: number
  completedSteps: number
  startedAt: number
  completedAt: number
} {
  // Include entry step in the list of all steps
  const allSteps = entryStep
    ? [entryStep, ...Object.keys(flowSteps)]
    : Object.keys(flowSteps)

  const completedSteps = new Set<string>()
  const failedSteps = new Set<string>()
  let startedAt = 0
  let completedAt = 0

  for (const event of events) {
    if (event.type === 'flow.start') {
      startedAt = typeof event.ts === 'string' ? new Date(event.ts).getTime() : 0
    }
    if (event.type === 'step.completed' && 'stepName' in event) {
      completedSteps.add(event.stepName)
    }
    if (event.type === 'step.failed' && 'stepName' in event) {
      failedSteps.add(event.stepName)
    }
  }

  const totalSteps = allSteps.length
  const hasFailures = failedSteps.size > 0
  const allCompleted = allSteps.every(step =>
    completedSteps.has(step) || failedSteps.has(step),
  )

  let status: 'running' | 'completed' | 'failed' = 'running'

  if (allCompleted) {
    status = hasFailures ? 'failed' : 'completed'
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
export function createFlowWiring(deps: FlowWiringDeps) {
  const { adapter } = deps
  const bus = getEventBus()
  const unsubs: Array<() => void> = []
  let wired = false

  /**
   * Add flow run to sorted set index for listing
   */
  const indexFlowRun = async (flowName: string, flowId: string, timestamp: number, metadata?: Record<string, any>) => {
    try {
      const store = useEventStore()
      const names = store.names()
      // Use centralized naming function
      const indexKey = names.flowIndex(flowName)

      await store.indexAdd(indexKey, flowId, timestamp, metadata)

      if (process.env.NQ_DEBUG_EVENTS === '1') {
        console.log('[flow-wiring] indexed run', { flowName, flowId, indexKey, timestamp, metadata })
      }
    }
    catch (err) {
      console.error('[flow-wiring] failed to index run:', err)
    }
  }

  function start() {
    if (wired) return
    wired = true

    // Get stream names utility
    const store = useEventStore()
    const names = store.names()

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
        const streamName = names.flow(runId)
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

        // Append to stream
        await adapter.append(streamName, eventData)

        if (process.env.NQ_DEBUG_EVENTS === '1' || e.type === 'flow.completed' || e.type === 'flow.failed') {
          console.log('[flow-wiring][PERSISTENCE] stored event to stream', {
            type: e.type,
            flowName,
            runId,
            stepName: 'stepName' in e ? e.stepName : undefined,
          })
        }
      }
      catch (err) {
        console.error('[flow-wiring] ERROR persisting event:', {
          type: e.type,
          runId: e.runId,
          flowName: e.flowName,
          error: (err as any)?.message,
        })
      }
    }

    // ============================================================================
    // HANDLER 2: ORCHESTRATION - Update metadata, analyze completion, trigger events
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

        const streamName = names.flow(runId)
        const indexKey = names.flowIndex(flowName)

        // For flow.start, initialize index with running status
        if (e.type === 'flow.start') {
          const timestamp = Date.now()
          await indexFlowRun(flowName, runId, timestamp, {
            status: 'running',
            startedAt: timestamp,
            stepCount: 0,
            completedSteps: 0,
            emittedEvents: [],
          })
        }

        // For step.completed events, increment completedSteps counter
        if (e.type === 'step.completed') {
          try {
            // Use atomic increment to avoid race conditions in parallel steps
            const newCount = await store.indexIncrement(indexKey, runId, 'completedSteps', 1)

            console.log('[flow-wiring] incremented completedSteps', {
              flowName,
              runId,
              stepName: 'stepName' in e ? e.stepName : 'unknown',
              newCount,
            })
          }
          catch (err) {
            console.warn('[flow-wiring] Failed to update completedSteps', {
              flowName,
              runId,
              error: (err as any)?.message,
            })
          }
        }

        // For emit events, track emitted events in metadata
        if (e.type === 'emit') {
          const emitEvent = e as EmitEvent

          // Emit events use 'name' field, not 'topic' - extract from data
          const eventName = (emitEvent.data as any)?.name || emitEvent.data?.topic

          if (!eventName) {
            console.warn('[flow-wiring] emit event missing name/topic', { flowName, runId, data: emitEvent.data })
          }
          else {
            try {
              const currentEntry = await store.indexGet(indexKey, runId)
              // Filter out any null/undefined values from corrupted data
              const emittedEvents = ((currentEntry?.metadata?.emittedEvents || []) as any[])
                .filter((item: any) => item != null && typeof item === 'string') as string[]

              // Add new event if not already tracked
              if (!emittedEvents.includes(eventName)) {
                await store.indexUpdateWithRetry(indexKey, runId, {
                  emittedEvents: [...emittedEvents, eventName],
                })

                console.log('[flow-wiring] tracked emit event', {
                  flowName,
                  runId,
                  name: eventName,
                  allEmitted: [...emittedEvents, eventName],
                })
              }
            }
            catch (err) {
              console.warn('[flow-wiring] Failed to track emitted event', {
                flowName,
                runId,
                event: eventName,
                error: (err as any)?.message,
              })
            }

            // ORCHESTRATION: Check if any steps can now be triggered
            await checkAndTriggerPendingSteps(flowName, runId, store)
          }
        }

        // For step.completed or step.failed, check if flow is complete
        // IMPORTANT: Do this AFTER incrementing completedSteps to avoid race condition
        if (e.type === 'step.completed' || e.type === 'step.failed') {
          // ORCHESTRATION: Check if any steps can now be triggered
          await checkAndTriggerPendingSteps(flowName, runId, store)

          // Small delay to ensure completedSteps increment is persisted
          await new Promise(resolve => setTimeout(resolve, 50))

          try {
            // Read all events for this flow to analyze completion
            const allEvents = await store.read(streamName)

            // Get analyzed flow definition from build-time analysis
            const analyzedFlows = $useAnalyzedFlows()
            const flowDef = analyzedFlows.find((f: any) => f.id === flowName)

            if (flowDef?.steps) {
              const entryStepName = (flowDef as any).entry?.step
              const analysis = analyzeFlowCompletion(flowDef.steps, entryStepName, allEvents)

              // Build update object, only include defined values
              const updateMetadata: Record<string, any> = {
                status: analysis.status,
                stepCount: analysis.totalSteps,
              }

              // Only add completedAt if flow is in terminal state
              if (analysis.status !== 'running' && analysis.completedAt) {
                updateMetadata.completedAt = analysis.completedAt
              }

              // Update metadata with current state
              await store.indexUpdateWithRetry(indexKey, runId, updateMetadata)

              // If flow reached terminal state, publish terminal event to bus
              // The persistence handler will store it, and other plugins can react to it
              if (analysis.status === 'completed' || analysis.status === 'failed') {
                const eventType = analysis.status === 'completed' ? 'flow.completed' : 'flow.failed'

                // Check if terminal event was already published to avoid duplicates
                // This can happen when multiple steps complete rapidly at the end
                const terminalEventExists = allEvents.some((evt: EventRecord) =>
                  evt.type === 'flow.completed' || evt.type === 'flow.failed',
                )

                if (terminalEventExists) {
                  if (process.env.NQ_DEBUG_EVENTS === '1') {
                    console.log('[flow-wiring][ORCHESTRATION] terminal event already exists, skipping publish', {
                      flowName,
                      runId,
                      eventType,
                    })
                  }
                }
                else {
                  console.log('[flow-wiring][ORCHESTRATION] publishing terminal event to bus', {
                    flowName,
                    runId,
                    eventType,
                  })

                  // Publish to bus WITHOUT id/ts so it gets persisted by handlePersistence
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
            console.warn('[flow-wiring] Failed to analyze flow completion', {
              flowName,
              runId,
              error: (err as any)?.message,
            })
          }
        }
      }
      catch (err) {
        console.error('[flowWiring] ERROR handling event:', {
          type: e.type,
          runId: e.runId,
          flowName: e.flowName,
          error: (err as any)?.message,
          stack: (err as any)?.stack,
        })
      }
    }

    // v0.4: Subscribe to event types with BOTH handlers
    // Order matters: Persistence runs first, then orchestration
    const eventTypes = [
      'flow.start', 'flow.completed', 'flow.failed',
      'step.started', 'step.completed', 'step.failed', 'step.retry',
      'log', 'emit', 'state',
    ]

    // Register persistence handler first (stores events)
    for (const type of eventTypes) {
      unsubs.push(bus.onType(type, handlePersistence))
    }

    // Register orchestration handler second (updates metadata, triggers new events)
    for (const type of eventTypes) {
      unsubs.push(bus.onType(type, handleOrchestration))
    }
  }

  function stop() {
    for (const u of unsubs.splice(0)) {
      try {
        u()
      }
      catch {
        // ignore
      }
    }

    wired = false

    if (process.env.NQ_DEBUG_EVENTS === '1') {
      console.log('[flow-wiring] stopped')
    }
  }

  return { start, stop }
}
