import { ref, computed, type Ref } from 'vue'

/**
 * v0.3 Client-Side Flow State Reducer
 *
 * Reduces an array of events from the flow timeline into current state.
 * This follows the Motia pattern where the client computes state from events.
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
  kind: string
  subject: string
  flow?: string
  step?: string
  trigger?: string
  correlationId?: string
  data?: any
  meta?: any
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
    switch (e.kind) {
      case 'flow.start':
      case 'flow.started':
        state.status = 'running'
        state.startedAt = e.ts
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
        const stepKey = e.step || e.data?.stepKey
        if (!stepKey) break
        if (!state.steps[stepKey]) {
          state.steps[stepKey] = {
            status: 'running',
            attempt: 1,
          }
        }
        state.steps[stepKey].status = 'running'
        state.steps[stepKey].startedAt = e.ts
        state.steps[stepKey].attempt = e.meta?.attempt || state.steps[stepKey].attempt || 1
        break
      }

      case 'step.completed': {
        const stepKey = e.step || e.data?.stepKey
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
        const stepKey = e.step || e.data?.stepKey
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
        const stepKey = e.step || e.data?.stepKey
        if (!stepKey) break
        if (!state.steps[stepKey]) {
          state.steps[stepKey] = { status: 'retrying', attempt: 1 }
        }
        state.steps[stepKey].status = 'retrying'
        state.steps[stepKey].attempt = e.meta?.attempt || e.data?.attempt || 1
        break
      }

      case 'step.await.time':
      case 'step.await.event':
      case 'step.await.trigger': {
        const stepKey = e.step || e.data?.stepKey
        if (!stepKey) break
        if (!state.steps[stepKey]) {
          state.steps[stepKey] = { status: 'waiting', attempt: 1 }
        }
        state.steps[stepKey].status = 'waiting'
        state.steps[stepKey].awaitType = e.kind.split('.')[2] as 'time' | 'event' | 'trigger'
        state.steps[stepKey].awaitData = e.data
        break
      }

      case 'step.resumed': {
        const stepKey = e.step || e.data?.stepKey
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
        const stepKey = e.step || e.data?.stepKey
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
        const stepKey = e.step || (e.meta as any)?.stepKey
        state.logs.push({
          ts: e.ts,
          step: stepKey,
          level: e.data?.level || 'info',
          msg: e.data?.message || e.data?.msg || String(e.data),
          data: e.data,
        })
        break
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
