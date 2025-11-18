/**
 * State Wiring - Automatic cleanup of flow state
 *
 * Subscribes to the local event bus (single source of truth) and handles
 * automatic cleanup of flow state based on configuration strategy.
 *
 * Cleanup strategies:
 * - 'never': State persists indefinitely (default)
 * - 'on-complete': Cleanup when flow completes (recommended)
 * - 'immediate': Cleanup after each step (not recommended)
 * - 'ttl': State expires automatically via TTL (handled by storage provider)
 *
 * Benefits:
 * - Single source of truth (event bus)
 * - Configurable cleanup strategies
 * - Clear separation of concerns
 */

import type { EventRecord } from '../../adapters/interfaces/store'
import { getEventBus } from '../eventBus'
import { useNventLogger, useStateAdapter, useRuntimeConfig } from '#imports'

export interface StateWiringOptions {
  /**
   * Cleanup strategy
   * - 'never': State persists indefinitely
   * - 'on-complete': Cleanup when flow completes (recommended)
   * - 'immediate': Cleanup after each step
   * - 'ttl': State expires automatically via TTL
   * Default: 'never'
   */
  strategy?: 'never' | 'on-complete' | 'immediate' | 'ttl'
}

/**
 * Create state wiring
 *
 * Subscribes to event bus and handles state cleanup based on configuration
 */
export function createStateWiring(opts?: StateWiringOptions) {
  // Get strategy from options or runtime config
  let strategy = opts?.strategy

  if (!strategy) {
    try {
      const rc: any = useRuntimeConfig()
      strategy = rc?.nvent?.store?.state?.cleanup?.strategy || 'never'
    }
    catch {
      strategy = 'never'
    }
  }

  const bus = getEventBus()
  const unsubs: Array<() => void> = []
  let wired = false

  function start() {
    if (wired) return
    wired = true

    // Only set up listeners if cleanup is enabled
    if (strategy === 'never' || strategy === 'ttl') {
      return
    }

    const logger = useNventLogger('state-wiring')
    const stateAdapter = useStateAdapter()

    logger.info('Starting state wiring', { strategy })

    // Cleanup when flow completes (recommended)
    if (strategy === 'on-complete') {
      // Cleanup on flow completion
      const handleFlowCompleted = async (event: EventRecord) => {
        const flowId = event.runId
        if (!flowId) return

        try {
          const pattern = `flow:${flowId}:*`
          const deletedCount = await stateAdapter.clear(pattern)

          if (deletedCount > 0) {
            logger.info('Cleaned up state after flow completion', {
              flowId,
              deletedCount,
            })
          }
        }
        catch (error) {
          logger.error('Error cleaning up state after flow completion', {
            flowId,
            error: (error as any)?.message,
          })
        }
      }

      // Cleanup on flow failure
      const handleFlowFailed = async (event: EventRecord) => {
        const flowId = event.runId
        if (!flowId) return

        try {
          const pattern = `flow:${flowId}:*`
          const deletedCount = await stateAdapter.clear(pattern)

          if (deletedCount > 0) {
            logger.info('Cleaned up state after flow failure', {
              flowId,
              deletedCount,
            })
          }
        }
        catch (error) {
          logger.error('Error cleaning up state after flow failure', {
            flowId,
            error: (error as any)?.message,
          })
        }
      }

      unsubs.push(bus.onType('flow.completed', handleFlowCompleted))
      unsubs.push(bus.onType('flow.failed', handleFlowFailed))

      logger.debug('State cleanup enabled: on-complete')
    }

    // Cleanup immediately after each step completes
    else if (strategy === 'immediate') {
      const handleStepCompleted = async (event: EventRecord) => {
        const flowId = event.runId
        if (!flowId) return

        try {
          const pattern = `flow:${flowId}:*`
          const deletedCount = await stateAdapter.clear(pattern)

          if (deletedCount > 0) {
            logger.info('Cleaned up state after step completion', {
              flowId,
              stepName: (event as any).stepName,
              deletedCount,
            })
          }
        }
        catch (error) {
          logger.error('Error cleaning up state after step', {
            flowId,
            error: (error as any)?.message,
          })
        }
      }

      unsubs.push(bus.onType('step.completed', handleStepCompleted))

      logger.debug('State cleanup enabled: immediate')
    }

    logger.info('State wiring started')
  }

  function stop() {
    const logger = useNventLogger('state-wiring')

    for (const unsub of unsubs.splice(0)) {
      try {
        unsub()
      }
      catch {
        // ignore
      }
    }

    wired = false
    logger.debug('State wiring stopped')
  }

  return { start, stop }
}
