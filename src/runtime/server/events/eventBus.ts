import { EventEmitter } from 'node:events'
import type { EventRecord } from '../../types'

// v0.4 Event Bus - publishes events to internal subscribers
type Handler = (e: EventRecord) => void

// Ensure a single emitter across Nitro HMR and module reloads
declare global {
  var __nq_bus_emitter: EventEmitter | undefined
}

const emitter: EventEmitter = globalThis.__nq_bus_emitter ??= new EventEmitter()

// Set a sensible default to avoid MaxListeners warnings while still surfacing leaks.
// You can override via env NQ_BUS_MAX_LISTENERS if needed.
try {
  const max = Number(process.env.NQ_BUS_MAX_LISTENERS || 100)
  if (!Number.isNaN(max) && max > 0) emitter.setMaxListeners(max)
}
catch {
  // ignore
}

function eventNameForRunId(runId: string) {
  return `runId:${runId}`
}
function eventNameForType(type: string) {
  return `type:${type}`
}

function publish(event: EventRecord) {
  // Emit both runId and type channels synchronously
  emitter.emit(eventNameForRunId(event.runId), event)
  emitter.emit(eventNameForType(event.type), event)
}

function subscribeRunId(runId: string, handler: Handler) {
  const name = eventNameForRunId(runId)
  emitter.on(name, handler)
  return () => {
    emitter.off(name, handler)
  }
}

function onType(type: string, handler: Handler) {
  const name = eventNameForType(type)
  emitter.on(name, handler)
  return () => {
    emitter.off(name, handler)
  }
}

export const eventBus = { publish, subscribeRunId, onType }

// Legacy aliases for compatibility during migration
export function subscribeSubject(subject: string, handler: Handler) {
  return subscribeRunId(subject, handler)
}

export function onKind(kind: string, handler: Handler) {
  return onType(kind, handler)
}

export function getEventBus() {
  return eventBus
}
