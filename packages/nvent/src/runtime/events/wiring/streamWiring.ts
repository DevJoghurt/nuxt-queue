/**
 * Stream Wiring - Bridge event bus to StreamAdapter for real-time UI updates
 *
 * Architecture:
 * 1. Event Bus - Single source of truth for all events (in-memory)
 * 2. StreamWiring - Bridges persisted events to stream topics (this file)
 * 3. StreamAdapter - Pub/sub for real-time distribution (Redis/Memory)
 * 4. WebSocket handlers - Subscribe to topics and send to clients
 *
 * Flow:
 * Event Bus → StreamWiring → StreamAdapter → WebSocket → UI
 *
 * Stream Topics (defined in useStreamTopics):
 * - stream:flow:events:{runId} - Flow events for specific run
 * - stream:flow:stats - Flow statistics updates
 * - stream:trigger:events:{triggerName} - Trigger events
 * - stream:trigger:stats - Trigger statistics updates
 *
 * Only publishes persisted events (with id/ts) to avoid duplicates
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
    const { StreamTopics } = useStreamTopics()

    logger.info('Starting stream wiring for UI clients')

    // Publish persisted flow events to UI clients via StreamAdapter
    const handleFlowEvent = async (e: EventRecord) => {
      // Only publish persisted events (with id/ts from store)
      if (!e.id || !e.ts) return

      const runId = e.runId
      if (!runId) return

      try {
        const topic = StreamTopics.flowEvents(runId)

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

        logger.debug('Published flow event to stream', { type: e.type, runId })
      }
      catch (err) {
        logger.error('Failed to publish flow event to stream', {
          error: (err as any)?.message,
        })
      }
    }

    // Publish persisted trigger events to UI clients via StreamAdapter
    const handleTriggerEvent = async (e: EventRecord) => {
      // Only publish persisted events (with id/ts from store)
      if (!e.id || !e.ts) return

      const triggerName = (e as any).triggerName
      if (!triggerName) return

      try {
        const topic = StreamTopics.triggerEvents(triggerName)

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

        logger.debug('Published trigger event to stream', {
          triggerName,
          type: e.type,
          id: e.id,
        })
      }
      catch (err) {
        logger.error('Failed to publish trigger event to stream', {
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

    // Publish flow stats updates to UI clients
    const handleFlowStatsUpdate = async (e: any) => {
      try {
        const topic = StreamTopics.flowStats()

        await stream.publish(topic, {
          id: e.flowName,
          metadata: e.metadata,
        })

        logger.debug('Published flow stats to stream', { flowName: e.flowName })
      }
      catch (err) {
        logger.error('Failed to publish flow stats to stream', {
          flowName: e.flowName,
          error: (err as any)?.message,
        })
      }
    }

    // Publish trigger stats updates to UI clients
    const handleTriggerStatsUpdate = async (e: any) => {
      try {
        const topic = StreamTopics.triggerStats()

        await stream.publish(topic, {
          id: e.triggerName,
          metadata: e.metadata,
        })

        logger.debug('Published trigger stats to stream', { triggerName: e.triggerName })
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
      unsubs.push(bus.onType(type, handleFlowEvent))
    }

    // Register trigger event handlers
    for (const type of triggerEventTypes) {
      unsubs.push(bus.onType(type, handleTriggerEvent))
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
