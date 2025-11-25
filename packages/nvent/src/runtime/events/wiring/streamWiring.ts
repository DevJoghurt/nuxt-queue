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
    const { getClientFlowTopic, getTriggerEventTopic } = useStreamTopics()

    logger.info('Starting stream wiring for UI clients')

    // Publish persisted flow events to UI clients via StreamAdapter
    const handleFlowClientMessage = async (e: EventRecord) => {
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

        logger.debug('Published flow event to UI clients', { type: e.type, runId })
      }
      catch (err) {
        logger.error('Failed to publish flow event to UI clients', {
          error: (err as any)?.message,
        })
      }
    }

    // Publish persisted trigger events to UI clients via StreamAdapter
    const handleTriggerClientMessage = async (e: EventRecord) => {
      // Only publish persisted events (with id/ts from store)
      if (!e.id || !e.ts) return

      const triggerName = (e as any).triggerName
      if (!triggerName) return

      try {
        const topic = getTriggerEventTopic(triggerName)

        await stream.publish(topic, {
          type: 'trigger.event',
          data: {
            event: {
              id: e.id,
              ts: e.ts,
              type: e.type,
              triggerName,
              data: e.data,
            },
          },
          timestamp: Date.now(),
        })

        logger.debug('Published trigger event to UI clients', {
          triggerName,
          type: e.type,
          id: e.id,
        })
      }
      catch (err) {
        logger.error('Failed to publish trigger event to UI clients', {
          triggerName,
          type: e.type,
          error: (err as any)?.message,
        })
      }
    }

    // Subscribe to all flow event types that clients should receive
    const flowEventTypes = [
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
    ]

    // Subscribe to all trigger event types that clients should receive
    const triggerEventTypes = [
      'trigger.registered',
      'trigger.updated',
      'trigger.deleted',
      'trigger.fired',
      'subscription.added',
      'subscription.removed',
    ]

    // Handler for flow stats updates
    const handleFlowStatsUpdate = async (e: any) => {
      try {
        const { SubjectPatterns } = useStreamTopics()
        const flowIndexKey = SubjectPatterns.flowIndex()
        const topic = `store:index:${flowIndexKey}`

        await stream.publish(topic, {
          id: e.flowName,
          metadata: e.metadata,
        })

        logger.debug('Published flow stats update to stream', { flowName: e.flowName })
      }
      catch (err) {
        logger.error('Failed to publish flow stats to stream', {
          flowName: e.flowName,
          error: (err as any)?.message,
        })
      }
    }

    // Handler for trigger stats updates
    const handleTriggerStatsUpdate = async (e: any) => {
      try {
        const { SubjectPatterns } = useStreamTopics()
        const triggerIndexKey = SubjectPatterns.triggerIndex()
        const topic = `store:index:${triggerIndexKey}`

        await stream.publish(topic, {
          id: e.triggerName,
          metadata: e.metadata,
        })

        logger.debug('Published trigger stats update to stream', { triggerName: e.triggerName })
      }
      catch (err) {
        logger.error('Failed to publish trigger stats to stream', {
          triggerName: e.triggerName,
          error: (err as any)?.message,
        })
      }
    }

    // Register flow event handlers
    for (const type of flowEventTypes) {
      unsubs.push(bus.onType(type, handleFlowClientMessage))
    }

    // Register trigger event handlers
    for (const type of triggerEventTypes) {
      unsubs.push(bus.onType(type, handleTriggerClientMessage))
    }

    // Register flow stats update handler
    unsubs.push(bus.onType('flow.stats.updated', handleFlowStatsUpdate))

    // Register trigger stats update handler
    unsubs.push(bus.onType('trigger.stats.updated', handleTriggerStatsUpdate))

    logger.info('Stream wiring started - listening for persisted flow and trigger events')
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
