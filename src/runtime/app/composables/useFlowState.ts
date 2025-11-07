import { ref, computed, type Ref } from 'vue'

/**
 * Client-Side Flow State Reducer
 *
 * Reduces an array of events from the flow timeline into current state.
 */

export interface FlowState {
  status: 'running' | 'completed' | 'failed'
  startedAt?: string
  completedAt?: string
  steps: Record<string, StepState>
  logs: LogEntry[]
  meta?: Record<string, any>
}

export interface StepState {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'retrying' | 'waiting' | 'timeout'
  attempt: number
  startedAt?: string
  completedAt?: string
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

  // Infer flow completion if no explicit flow.completed event was found
  // A flow is considered complete if:
  // 1. It has started
  // 2. It has at least one step
  // 3. All steps have a terminal status (completed, failed, or timeout)
  // 4. No steps are running, retrying, or waiting
  if (state.status === 'running' && state.startedAt && Object.keys(state.steps).length > 0) {
    const hasRunningSteps = Object.values(state.steps).some(
      s => s.status === 'running' || s.status === 'retrying' || s.status === 'waiting',
    )
    const hasFailedSteps = Object.values(state.steps).some(s => s.status === 'failed')
    const allStepsTerminal = Object.values(state.steps).every(
      s => s.status === 'completed' || s.status === 'failed' || s.status === 'timeout',
    )

    if (!hasRunningSteps && allStepsTerminal) {
      // Infer completion status
      if (hasFailedSteps) {
        state.status = 'failed'
      }
      else {
        state.status = 'completed'
      }
      // Set completion time to the latest step completion time
      const latestCompletion = Object.values(state.steps)
        .map(s => s.completedAt)
        .filter(Boolean)
        .sort()
        .pop()
      if (latestCompletion) {
        state.completedAt = latestCompletion
      }
    }
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
    stepList,
    runningSteps,
    waitingSteps,
    failedSteps,
    completedSteps,
  }
}
