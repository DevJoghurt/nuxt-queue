import { useRuntimeConfig } from '#imports'
import { getEventBus, subscribeSubject as legacySubscribeSubject, onKind as legacyOnKind } from '../events/eventBus'
import type { EventRecord } from '../../types'

export interface EventManager {
  /**
   * Publish an event directly to the in-proc bus.
   */
  publishBus(evt: Partial<EventRecord>): Promise<void>
  onType: (type: string, handler: (e: EventRecord) => void) => () => void
  subscribeRunId: ReturnType<typeof getEventBus>['subscribeRunId']
  // Legacy v0.3 compatibility
  onKind: (kind: string, handler: (e: EventRecord) => void) => () => void
  subscribeSubject: (subject: string, handler: (e: EventRecord) => void) => () => void
}

// Use global to survive HMR reloads
declare global {
  var __nq_event_manager: EventManager | undefined
}

// Internal getter (no `use` prefix). Utils wrapper will expose `useEventManager`.
export function useEventManager(): EventManager {
  if (globalThis.__nq_event_manager) return globalThis.__nq_event_manager
  const bus = getEventBus()
  const rc: any = useRuntimeConfig()
  const DEBUG = rc?.queue?.debug?.events || process.env.NQ_DEBUG_EVENTS === '1'

  const publishBus: EventManager['publishBus'] = async (evt) => {
    // v0.4: Pass-through publish to bus with runId-based routing
    const rec: any = {
      type: evt.type,
      runId: (evt as any)?.runId || '',
      flowName: (evt as any)?.flowName,
      stepName: (evt as any)?.stepName,
      stepId: (evt as any)?.stepId,
      attempt: (evt as any)?.attempt,
      data: (evt as any)?.data,
    }
    if ((evt as any)?.id != null) rec.id = (evt as any).id
    if ((evt as any)?.ts != null) rec.ts = (evt as any).ts

    bus.publish(rec as any)
    if (DEBUG) {
      try {
        console.log('[nq][event-manager.publishBus]', { type: rec.type, runId: rec.runId })
      }
      catch {
        // ignore
      }
    }
  }

  // v0.4: Subscribe to a runId using the underlying adapter
  const subscribeRunId: EventManager['subscribeRunId'] = (runId: string, handler: (e: EventRecord) => void) => {
    return bus.subscribeRunId(runId, handler)
  }

  // Subscribe by type using the in-proc event bus
  const onType: EventManager['onType'] = (type, handler) => {
    return bus.onType(type, handler)
  }

  // Legacy v0.3 compatibility
  const subscribeSubject: EventManager['subscribeSubject'] = (subject: string, handler: (e: EventRecord) => void) => {
    return legacySubscribeSubject(subject, handler)
  }

  const onKind: EventManager['onKind'] = (kind, handler) => {
    return legacyOnKind(kind, handler)
  }

  globalThis.__nq_event_manager = { publishBus, onType, subscribeRunId, onKind, subscribeSubject }
  return globalThis.__nq_event_manager
}

export function setEventManager(mgr: EventManager) {
  globalThis.__nq_event_manager = mgr
}
