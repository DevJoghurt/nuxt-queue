<<<<<<< HEAD
import { useServerLogger, defineNitroPlugin, useEventManager, useRuntimeConfig } from '#imports'
import { getStateProvider } from '../state/stateProvider'

const logger = useServerLogger('plugin-state-cleanup')
=======
import { useNventLogger, defineNitroPlugin, useEventManager, useRuntimeConfig } from '#imports'
import { getStateProvider } from '../../server-utils/state/stateFactory'
>>>>>>> 227da8b (refactoring)

/**
 * State Cleanup Plugin
 *
 * Handles automatic cleanup of flow state based on configuration strategy:
 * - 'never': State persists indefinitely
 * - 'immediate': Cleanup after each step (original behavior, not recommended)
 * - 'on-complete': Cleanup when flow completes (recommended, uses lifecycle tracking)
 * - 'ttl': State expires automatically via TTL (handled by storage provider)
 */
export default defineNitroPlugin(() => {
<<<<<<< HEAD
  const rc: any = useRuntimeConfig()
  // v0.4.1: Read cleanup config from store.state.cleanup
  const cleanup = rc?.queue?.store?.state?.cleanup || { strategy: 'never' }
=======
  const logger = useNventLogger('plugin-state-cleanup')
  const rc: any = useRuntimeConfig()
  const cleanup = rc?.queue?.state?.cleanup || { strategy: 'never' }
>>>>>>> 227da8b (refactoring)

  // Only set up listeners if cleanup is enabled
  if (cleanup.strategy === 'never' || cleanup.strategy === 'ttl') {
    return
  }

  const { onType } = useEventManager()
  const unsubs: Array<() => void> = []

  // Cleanup when flow completes (recommended)
  if (cleanup.strategy === 'on-complete') {
    unsubs.push(onType('flow.completed', async (event) => {
      const flowId = event.runId
      if (!flowId) return

      try {
        const sp = getStateProvider()
<<<<<<< HEAD
        const pattern = `flow:${flowId}:*`

        // Use clear() with pattern matching (much more efficient)
        const deletedCount = await sp.clear(pattern)

        if (deletedCount > 0) {
          logger.info(`Cleaned up ${deletedCount} state keys after flow completion`, { flowId })
=======
        const prefix = `flow:${flowId}:`
        const { keys } = await sp.list(prefix)

        if (keys.length > 0) {
          // Keys from list() include the namespace (e.g., 'nq:flow:123:key')
          // We need to strip the namespace prefix before calling delete()
          const rc: any = useRuntimeConfig()
          const ns = rc?.queue?.state?.namespace || 'nq'
          const nsPrefix = `${ns}:`

          await Promise.all(keys.map((k: string) => {
            // Remove namespace prefix to get the actual key
            const keyWithoutNs = k.startsWith(nsPrefix) ? k.substring(nsPrefix.length) : k
            return sp.delete(keyWithoutNs)
          }))

          logger.info(`Cleaned up ${keys.length} state keys after flow completion`, { flowId, keys })
>>>>>>> 227da8b (refactoring)
        }
      }
      catch (error) {
        logger.error('Error cleaning up state after flow completion', { flowId, error })
      }
    }))

    // Also cleanup on flow failure
    unsubs.push(onType('flow.failed', async (event) => {
      const flowId = event.runId
      if (!flowId) return

      try {
        const sp = getStateProvider()
<<<<<<< HEAD
        const pattern = `flow:${flowId}:*`

        // Use clear() with pattern matching (much more efficient)
        const deletedCount = await sp.clear(pattern)

        if (deletedCount > 0) {
          logger.info(`Cleaned up ${deletedCount} state keys after flow failure`, { flowId })
=======
        const prefix = `flow:${flowId}:`
        const { keys } = await sp.list(prefix)

        if (keys.length > 0) {
          // Keys from list() include the namespace (e.g., 'nq:flow:123:key')
          // We need to strip the namespace prefix before calling delete()
          const rc: any = useRuntimeConfig()
          const ns = rc?.queue?.state?.namespace || 'nq'
          const nsPrefix = `${ns}:`

          await Promise.all(keys.map((k: string) => {
            // Remove namespace prefix to get the actual key
            const keyWithoutNs = k.startsWith(nsPrefix) ? k.substring(nsPrefix.length) : k
            return sp.delete(keyWithoutNs)
          }))

          logger.info(`Cleaned up ${keys.length} state keys after flow failure`, { flowId, keys })
>>>>>>> 227da8b (refactoring)
        }
      }
      catch (error) {
        logger.error('Error cleaning up state after flow failure', { flowId, error })
      }
    }))

    logger.debug('Plugin initialized with strategy: on-complete')
  }

  // Cleanup immediately after each step completes
  else if (cleanup.strategy === 'immediate') {
    unsubs.push(onType('step.completed', async (event) => {
      const flowId = event.runId
      if (!flowId) return

      try {
        const sp = getStateProvider()
<<<<<<< HEAD
        const pattern = `flow:${flowId}:*`

        // Use clear() with pattern matching (much more efficient)
        const deletedCount = await sp.clear(pattern)

        if (deletedCount > 0) {
          logger.info(`Cleaned up ${deletedCount} state keys after step completion`, { flowId })
=======
        const prefix = `flow:${flowId}:`
        const { keys } = await sp.list(prefix)

        if (keys.length > 0) {
          // Keys from list() include the namespace (e.g., 'nq:flow:123:key')
          // We need to strip the namespace prefix before calling delete()
          const rc: any = useRuntimeConfig()
          const ns = rc?.queue?.state?.namespace || 'nq'
          const nsPrefix = `${ns}:`

          await Promise.all(keys.map((k: string) => {
            // Remove namespace prefix to get the actual key
            const keyWithoutNs = k.startsWith(nsPrefix) ? k.substring(nsPrefix.length) : k
            return sp.delete(keyWithoutNs)
          }))

          logger.info(`Cleaned up ${keys.length} state keys after step completion`, { flowId, keys })
>>>>>>> 227da8b (refactoring)
        }
      }
      catch (error) {
        logger.error('Error cleaning up state after step', { flowId, error })
      }
    }))

    logger.debug('Plugin initialized with strategy: immediate')
  }

  return {
    hooks: {
      close: async () => {
        for (const u of unsubs) {
          try {
            u()
          }
          catch {
            // ignore
          }
        }
        unsubs.length = 0
      },
    },
  }
})
