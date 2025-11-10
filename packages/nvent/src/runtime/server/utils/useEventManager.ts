import { getEventBus } from '../events/eventBus'
import type { EventRecord } from '../types'
import { useServerLogger } from '#imports'

const logger = useServerLogger('event-manager')

export interface EventManager {
  /**
   * Publish an event directly to the in-proc bus.
   */
  publishBus(evt: Partial<EventRecord>): Promise<void>
  onType: (type: string, handler: (e: EventRecord) => void) => () => void
  subscribeRunId: ReturnType<typeof getEventBus>['subscribeRunId']
}

// Use global to survive HMR reloads
declare global {
  var __nq_event_manager: EventManager | undefined
}

// Internal getter (no `use` prefix). Utils wrapper will expose `useEventManager`.
export function useEventManager(): EventManager {
  if (globalThis.__nq_event_manager) return globalThis.__nq_event_manager
  const bus = getEventBus()

  const publishBus: EventManager['publishBus'] = async (evt) => {
    const rec: EventRecord = {
      ...(evt as any),
      runId: evt.runId || '',
    } as EventRecord

    bus.publish(rec)
    logger.debug('Published event to bus', { type: rec.type, runId: rec.runId })
  }

  const subscribeRunId: EventManager['subscribeRunId'] = (runId: string, handler: (e: EventRecord) => void) => {
    return bus.subscribeRunId(runId, handler)
  }

  const onType: EventManager['onType'] = (type, handler) => {
    return bus.onType(type, handler)
  }

  globalThis.__nq_event_manager = { publishBus, onType, subscribeRunId }
  return globalThis.__nq_event_manager
}

export function setEventManager(mgr: EventManager) {
  globalThis.__nq_event_manager = mgr
}
