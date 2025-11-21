/**
 * Stream Wiring - Publish flow events to UI clients via StreamAdapter
 *
 * Subscribes to the local event bus (single source of truth) and publishes
 * persisted events to the StreamAdapter for WebSocket/SSE clients.
 *
 * Simple and focused:
 * - Listens to event bus for persisted events (with id/ts)
 * - Publishes to client channel: client:flow:{runId}
 * - UI gets real-time updates
 *
 * Benefits:
 * - Single source of truth (event bus)
 * - Easy to debug (no republishing)
 * - Clear separation of concerns
 */

import type { EventRecord } from '../../adapters/interfaces/store'
import { getEventBus } from '../eventBus'
import { useNventLogger, useStreamAdapter, useStreamTopics } from '#imports'

export interface StreamWiringOptions {
  /**
   * Enable client messages (WebSocket/SSE)
   * Default: true
   */
  enabled?: boolean
}

/**
 * Create stream wiring
 *
 * Subscribes to event bus and publishes persisted events to UI clients
 */
export function createStreamWiring(opts: StreamWiringOptions = {}) {
  const {
    enabled = true,
  } = opts

  const bus = getEventBus()
  const unsubs: Array<() => void> = []
  let wired = false

  function start() {
    if (wired) return
    wired = true

    if (!enabled) return

    const logger = useNventLogger('stream-wiring')
    const stream = useStreamAdapter()
    const { getClientFlowTopic } = useStreamTopics()

    logger.info('Starting stream wiring for UI clients')

    // Publish persisted events to UI clients via StreamAdapter
    const handleClientMessage = async (e: EventRecord) => {
      // Only publish persisted events (with id/ts from store)
      if (!e.id || !e.ts) return

      const runId = e.runId
      if (!runId) return

      try {
        const topic = getClientFlowTopic(runId)

        await stream.publish(topic, {
          type: 'flow.event',
          data: {
            event: {
              id: e.id,
              ts: e.ts,
              type: e.type,
              runId: e.runId,
              flowName: e.flowName,
              // Include step-specific fields for UI
              stepName: (e as any).stepName,
              stepId: (e as any).stepId,
              attempt: (e as any).attempt,
              data: e.data,
            },
          },
          timestamp: Date.now(),
        })

        logger.debug('Published to UI clients', { type: e.type, runId })
      }
      catch (err) {
        logger.error('Failed to publish to UI clients', {
          error: (err as any)?.message,
        })
      }
    }

    // Subscribe to all event types that clients should receive
    const clientEventTypes = [
      'flow.start',
      'flow.completed',
      'flow.failed',
      'flow.cancel',
      'step.started',
      'step.completed',
      'step.failed',
      'step.retry',
      'await.registered',
      'await.resolved',
      'await.timeout',
      'log',
      'emit',
      'state',
    ]

    for (const type of clientEventTypes) {
      unsubs.push(bus.onType(type, handleClientMessage))
    }

    logger.info('Stream wiring started - listening for persisted events')
  }

  function stop() {
    const logger = useNventLogger('stream-wiring')

    for (const unsub of unsubs.splice(0)) {
      try {
        unsub()
      }
      catch {
        // ignore
      }
    }

    wired = false
    logger.debug('Stream wiring stopped')
  }

  return { start, stop }
}
