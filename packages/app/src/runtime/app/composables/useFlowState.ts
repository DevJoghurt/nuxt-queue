import { ref, computed, type Ref } from '#imports'

/**
 * Client-Side Flow State Reducer
 *
 * Reduces an array of events from the flow timeline into current state.
 */

export interface FlowState {
  status: 'running' | 'completed' | 'failed' | 'canceled' | 'stalled' | 'awaiting'
  startedAt?: string
  completedAt?: string
  steps: Record<string, StepState>
  logs: LogEntry[]
  meta?: Record<string, any>
}

export interface StepState {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'retrying' | 'waiting' | 'timeout' | 'stalled'
  attempt: number
  startedAt?: string
  completedAt?: string
  scheduledTriggerAt?: string // When await is scheduled to trigger (for time/schedule awaits)
  error?: string
  awaitType?: 'time' | 'event' | 'trigger'
  awaitData?: any
  result?: any
}

export interface LogEntry {
  ts: string
  step?: string
  level: string
  msg: string
  data?: any
}

export interface EventRecord {
  id: string
  ts: string
  type: string
  runId: string
  flowName?: string
  stepName?: string
  stepId?: string
  attempt?: number
  data?: any
}

/**
 * Reduce an array of events into current flow state
 */
export function reduceFlowState(events: EventRecord[]): FlowState {
  const state: FlowState = {
    status: 'running',
    steps: {},
    logs: [],
  }

  for (const e of events) {
    const eventType = e.type
    const stepKey = e.stepName

    switch (eventType) {
      case 'flow.start':
      case 'flow.started':
        state.status = 'running'
        state.startedAt = e.ts
        if (e.flowName) state.meta = { ...state.meta, flowName: e.flowName }
        if (e.data?.flowName) state.meta = { ...state.meta, flowName: e.data.flowName }
        if (e.data?.input) state.meta = { ...state.meta, input: e.data.input }
        if (e.data?.stallTimeout) state.meta = { ...state.meta, stallTimeout: e.data.stallTimeout }
        if (e.data?.trigger) {
          state.meta = {
            ...state.meta,
            triggerName: e.data.trigger.name,
            triggerType: e.data.trigger.type || 'manual',
          }
        }
        break

      case 'flow.complete':
      case 'flow.completed':
        state.status = 'completed'
        state.completedAt = e.ts
        if (e.data?.result) state.meta = { ...state.meta, result: e.data.result }
        break

      case 'flow.failed':
        state.status = 'failed'
        state.completedAt = e.ts
        if (e.data?.error) state.meta = { ...state.meta, error: e.data.error }
        break

      case 'flow.cancel':
      case 'flow.canceled':
        state.status = 'canceled'
        state.completedAt = e.ts
        break

      case 'flow.stalled':
        state.status = 'stalled'
        if (e.data?.lastActivityAt) state.meta = { ...state.meta, lastActivityAt: e.data.lastActivityAt }
        break

      case 'step.started': {
        if (!stepKey) break
        if (!state.steps[stepKey]) {
          state.steps[stepKey] = {
            status: 'running',
            attempt: 1,
          }
        }
        // Don't overwrite terminal states if step.started arrives out of order
        const currentStatus = state.steps[stepKey].status
        if (currentStatus !== 'completed' && currentStatus !== 'failed' && currentStatus !== 'timeout') {
          state.steps[stepKey].status = 'running'
        }
        state.steps[stepKey].startedAt = e.ts
        state.steps[stepKey].attempt = e.attempt || state.steps[stepKey].attempt || 1
        break
      }

      case 'step.completed': {
        if (!stepKey) break
        if (!state.steps[stepKey]) {
          state.steps[stepKey] = { status: 'completed', attempt: 1 }
        }
        state.steps[stepKey].status = 'completed'
        state.steps[stepKey].completedAt = e.ts
        if (e.data?.result !== undefined) state.steps[stepKey].result = e.data.result
        break
      }

      case 'step.failed': {
        if (!stepKey) break
        if (!state.steps[stepKey]) {
          state.steps[stepKey] = { status: 'failed', attempt: 1 }
        }
        const willRetry = e.data?.willRetry || e.data?.retry
        state.steps[stepKey].status = willRetry ? 'retrying' : 'failed'
        state.steps[stepKey].error = e.data?.error || e.data?.message
        if (!willRetry) {
          state.steps[stepKey].completedAt = e.ts
        }
        break
      }

      case 'step.retry': {
        if (!stepKey) break
        if (!state.steps[stepKey]) {
          state.steps[stepKey] = { status: 'retrying', attempt: 1 }
        }
        state.steps[stepKey].status = 'retrying'
        state.steps[stepKey].attempt = e.data?.nextAttempt || e.attempt || 1
        state.steps[stepKey].error = e.data?.error
        break
      }

      case 'step.stalled': {
        if (!stepKey) break
        if (!state.steps[stepKey]) {
          state.steps[stepKey] = { status: 'stalled', attempt: 1 }
        }
        state.steps[stepKey].status = 'stalled'
        state.steps[stepKey].error = e.data?.reason || 'Step execution interrupted'
        state.steps[stepKey].completedAt = e.ts
        break
      }

      case 'step.await.time':
      case 'step.await.event':
      case 'step.await.trigger': {
        if (!stepKey) break
        if (!state.steps[stepKey]) {
          state.steps[stepKey] = { status: 'waiting', attempt: 1 }
        }
        state.steps[stepKey].status = 'waiting'
        state.steps[stepKey].awaitType = eventType.split('.')[2] as 'time' | 'event' | 'trigger'
        state.steps[stepKey].awaitData = e.data
        break
      }

      case 'step.resumed': {
        if (!stepKey) break
        if (!state.steps[stepKey]) {
          state.steps[stepKey] = { status: 'running', attempt: 1 }
        }
        state.steps[stepKey].status = 'running'
        delete state.steps[stepKey].awaitType
        delete state.steps[stepKey].awaitData
        break
      }

      case 'step.await.timeout': {
        if (!stepKey) break
        if (!state.steps[stepKey]) {
          state.steps[stepKey] = { status: 'timeout', attempt: 1 }
        }
        state.steps[stepKey].status = 'timeout'
        state.steps[stepKey].error = `Await timeout after ${e.data?.duration}ms`
        state.steps[stepKey].completedAt = e.ts
        break
      }

      case 'await.registered': {
        if (!stepKey) break
        // Use the position from event data to create the correct await entry
        const position = e.data?.position || 'after' // Default to 'after' for backward compatibility
        const awaitKey = `${stepKey}:await-${position}`

        if (!state.steps[awaitKey]) {
          state.steps[awaitKey] = { status: 'waiting', attempt: 1 }
        }
        state.steps[awaitKey].status = 'waiting'
        state.steps[awaitKey].awaitType = e.data?.awaitType
        state.steps[awaitKey].awaitData = e.data
        // Capture scheduled trigger time from event data
        const scheduledAt = e.data?.resolveAt || e.data?.nextOccurrence
        if (scheduledAt) {
          state.steps[awaitKey].scheduledTriggerAt = new Date(scheduledAt).toISOString()
        }
        break
      }

      case 'await.resolved': {
        if (!stepKey) break
        // Use the position from event data to update the correct await entry
        const position = e.data?.position || 'after' // Default to 'after' for backward compatibility
        const awaitKey = `${stepKey}:await-${position}`

        if (!state.steps[awaitKey]) {
          state.steps[awaitKey] = { status: 'completed', attempt: 1 }
        }
        state.steps[awaitKey].status = 'completed'
        state.steps[awaitKey].completedAt = e.ts
        state.steps[awaitKey].awaitType = e.data?.awaitType
        if (e.data?.triggerData) state.steps[awaitKey].result = e.data.triggerData
        break
      }

      case 'await.timeout': {
        if (!stepKey) break
        // Use the position from event data to update the correct await entry
        const position = e.data?.position || 'after' // Default to 'after' for backward compatibility
        const awaitKey = `${stepKey}:await-${position}`

        if (!state.steps[awaitKey]) {
          state.steps[awaitKey] = { status: 'timeout', attempt: 1 }
        }
        state.steps[awaitKey].status = 'timeout'
        state.steps[awaitKey].error = `Await timeout`
        state.steps[awaitKey].completedAt = e.ts
        state.steps[awaitKey].awaitType = e.data?.awaitType
        break
      }

      case 'runner.log':
      case 'log': {
        state.logs.push({
          ts: e.ts,
          step: stepKey,
          level: e.data?.level || 'info',
          msg: e.data?.message || e.data?.msg || (typeof e.data === 'string' ? e.data : String(e.data)),
          data: e.data,
        })
        break
      }

      // Handle any unrecognized events - log for debugging
      default: {
        // Log unhandled event types to console for debugging
        if (typeof console !== 'undefined' && eventType && !eventType.startsWith('_')) {
          console.debug('[useFlowState] Unhandled event type:', eventType, {
            stepName: e.stepName,
            stepKey,
            data: e.data,
          })
        }
      }
    }
  }

  // If no flow start event was found but we have events, check first event
  if (!state.startedAt && events.length > 0 && events[0]) {
    state.startedAt = events[0].ts
  }

  // Infer flow status based on step states
  // Note: We can only infer 'awaiting' status here. We should NOT infer 'completed'
  // because we don't know how many total steps the flow has. The backend should
  // emit flow.completed when the flow is actually done.
  if (state.status === 'running' && state.startedAt && Object.keys(state.steps).length > 0) {
    const hasActiveRunningSteps = Object.values(state.steps).some(
      s => s.status === 'running' || s.status === 'retrying',
    )
    const hasWaitingSteps = Object.values(state.steps).some(s => s.status === 'waiting')

    // If there are waiting steps and no actively running steps, set status to 'awaiting'
    if (hasWaitingSteps && !hasActiveRunningSteps) {
      state.status = 'awaiting'
    }
    // Don't infer completion here - wait for explicit flow.completed event
    // The backend knows when the flow is truly complete
  }

  return state
}

/**
 * Composable for managing flow state from event stream
 *
 * Usage:
 * ```typescript
 * const { state, events, addEvent, addEvents, reset } = useFlowState()
 *
 * // Add events as they arrive
 * addEvent(newEvent)
 *
 * // Access computed state
 * console.log(state.value.status) // 'running' | 'completed' | 'failed'
 * ```
 */
export function useFlowState(initialEvents: EventRecord[] = []) {
  const events = ref<EventRecord[]>(initialEvents) as Ref<EventRecord[]>

  const state = computed(() => reduceFlowState(events.value))

  const addEvent = (event: EventRecord) => {
    events.value.push(event)
  }

  const addEvents = (newEvents: EventRecord[]) => {
    events.value.push(...newEvents)
  }

  const reset = (newEvents: EventRecord[] = []) => {
    events.value = newEvents
  }

  // Computed helpers
  const isRunning = computed(() => state.value.status === 'running')
  const isCompleted = computed(() => state.value.status === 'completed')
  const isFailed = computed(() => state.value.status === 'failed')
  const isCanceled = computed(() => state.value.status === 'canceled')
  const isStalled = computed(() => state.value.status === 'stalled')
  const isAwaiting = computed(() => state.value.status === 'awaiting')

  const stepList = computed(() => {
    return Object.entries(state.value.steps).map(([key, step]) => ({
      key,
      ...step,
    }))
  })

  const runningSteps = computed(() => {
    return stepList.value.filter(s => s.status === 'running')
  })

  const waitingSteps = computed(() => {
    return stepList.value.filter(s => s.status === 'waiting')
  })

  const failedSteps = computed(() => {
    return stepList.value.filter(s => s.status === 'failed')
  })

  const completedSteps = computed(() => {
    return stepList.value.filter(s => s.status === 'completed')
  })

  return {
    // Raw data
    events,
    state,

    // Methods
    addEvent,
    addEvents,
    reset,

    // Computed helpers
    isRunning,
    isCompleted,
    isFailed,
    isCanceled,
    isStalled,
    isAwaiting,
    stepList,
    runningSteps,
    waitingSteps,
    failedSteps,
    completedSteps,
  }
}
