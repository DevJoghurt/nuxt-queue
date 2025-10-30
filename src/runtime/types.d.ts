import type { WorkerOptions as BullmqWorkerOptions } from 'bullmq'
import type z from 'zod'
import type colors from 'tailwindcss/colors'
import type { JobSchemaArray, JobSchema } from './schema'

type NeutralColor = 'slate' | 'gray' | 'zinc' | 'neutral' | 'stone'
export type Color = Exclude<keyof typeof colors, 'inherit' | 'current' | 'transparent' | 'black' | 'white' | NeutralColor> | NeutralColor

export type Jobs = z.infer<typeof JobSchemaArray>
export type Job = z.infer<typeof JobSchema>

export type WorkerOptions = Omit<BullmqWorkerOptions, 'connection' | 'useWorkerThreads'>

export type WorkerConfig = Record<string, WorkerOptions>

export type QueueData = {
  name: string
  origin: 'remote' | 'local'
  active: boolean
  jobs: JobCounts
  worker: number
}

// Declarations for worker authoring helpers available via auto-imports at runtime
// These declarations make TS happy in worker files and tests.
export declare function defineQueueWorker(processor: (...args: any[]) => any): any
export declare function defineQueueConfig(cfg: any): any

// v0.4 Event Schema
export type EventType = 'flow.start' | 'flow.completed' | 'flow.failed' | 'step.started' | 'step.completed' | 'step.failed' | 'step.retry' | 'log' | 'emit' | 'state'

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

export type FlowEvent = FlowStartEvent | FlowCompletedEvent | StepStartedEvent | StepCompletedEvent | StepFailedEvent | LogEvent | EmitEvent | StateEvent

export type EventRecord = FlowEvent
