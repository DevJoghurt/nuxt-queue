// v0.4: Using runId-based routing

export interface PublishContext {
  queue?: string
  jobId?: string
  /** Flow run ID for flow events */
  flowId?: string
  /** Trigger ID for trigger events */
  triggerId?: string
}

export interface PublishPayload<T = any> {
  type: string
  runId: string
  flowName: string
  stepName?: string
  stepId?: string
  attempt?: number
  data?: T
}

// v0.4 Event Schema
export type EventType = 'flow.start' | 'flow.completed' | 'flow.failed' | 'flow.cancel' | 'step.started' | 'step.completed' | 'step.failed' | 'step.retry' | 'log' | 'emit' | 'state' | 'flow.stalled'

export interface BaseEvent {
  id?: string // Redis stream ID (auto-generated, not present for ingress events)
  ts?: string // ISO timestamp (auto-generated, not present for ingress events)
  type: EventType
  runId: string // Flow run UUID
  flowName: string // Flow definition name
}

export interface StepEvent extends BaseEvent {
  stepName: string
  stepId: string
  attempt: number
}

export interface FlowStartEvent extends BaseEvent {
  type: 'flow.start'
  data?: {
    input?: any
  }
}

export interface FlowCompletedEvent extends BaseEvent {
  type: 'flow.completed'
  data?: {
    result?: any
  }
}

export interface FlowFailedEvent extends BaseEvent {
  type: 'flow.failed'
  data?: {
    error?: string
    stack?: string
  }
}

export interface FlowCancelEvent extends BaseEvent {
  type: 'flow.cancel'
  data?: {
    canceledAt?: string
  }
}

export interface FlowStalledEvent extends BaseEvent {
  type: 'flow.stalled'
  data?: {
    lastActivityAt?: number
    stallTimeout?: number
  }
}

export interface StepStartedEvent extends StepEvent {
  type: 'step.started'
  data?: {
    input?: any
  }
}

export interface StepCompletedEvent extends StepEvent {
  type: 'step.completed'
  data?: {
    result?: any
  }
}

export interface StepFailedEvent extends StepEvent {
  type: 'step.failed'
  data?: {
    error?: string
    stack?: string
  }
}

export interface StepRetryEvent extends StepEvent {
  type: 'step.retry'
  data?: {
    stepName: string
    queue: string
    attempt: number
    maxAttempts: number
    nextAttempt: number
  }
}

export interface LogEvent extends StepEvent {
  type: 'log'
  data: {
    level: 'debug' | 'info' | 'warn' | 'error'
    message: string
    [key: string]: any
  }
}

export interface EmitEvent extends StepEvent {
  type: 'emit'
  data: {
    topic: string
    payload: any
  }
}

export interface StateEvent extends StepEvent {
  type: 'state'
  data: {
    operation: 'get' | 'set' | 'delete'
    scope?: string
    key: string
    value?: any
  }
}

export type FlowEvent = FlowStartEvent | FlowCompletedEvent | FlowFailedEvent | FlowCancelEvent | FlowStalledEvent | StepStartedEvent | StepCompletedEvent | StepFailedEvent | StepRetryEvent | LogEvent | EmitEvent | StateEvent
