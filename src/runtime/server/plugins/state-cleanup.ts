import { defineNitroPlugin, useEventManager, useRuntimeConfig } from '#imports'
import { getStateProvider } from '../state/stateFactory'

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
  const rc: any = useRuntimeConfig()
  const cleanup = rc?.queue?.state?.cleanup || { strategy: 'never' }

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
        const prefix = `flow:${flowId}:`
        const { keys } = await sp.list(prefix)

        if (keys.length > 0) {
          await Promise.all(keys.map((k: string) => sp.delete(k.replace(prefix, ''))))

          if (process.env.NQ_DEBUG_STATE === '1') {
            console.log(`[state-cleanup] Cleaned up ${keys.length} state keys after flow completion (on-complete strategy)`)
          }
        }
      }
      catch (error) {
        console.error(`[state-cleanup] Error cleaning up state after flow completion:`, error)
      }
    }))

    // Also cleanup on flow failure
    unsubs.push(onType('flow.failed', async (event) => {
      const flowId = event.runId
      if (!flowId) return

      try {
        const sp = getStateProvider()
        const prefix = `flow:${flowId}:`
        const { keys } = await sp.list(prefix)

        if (keys.length > 0) {
          await Promise.all(keys.map((k: string) => sp.delete(k.replace(prefix, ''))))

          if (process.env.NQ_DEBUG_STATE === '1') {
            console.log(`[state-cleanup] Cleaned up ${keys.length} state keys after flow failure (on-complete strategy)`)
          }
        }
      }
      catch (error) {
        console.error(`[state-cleanup] Error cleaning up state after flow failure:`, error)
      }
    }))

    if (process.env.NQ_DEBUG_STATE === '1') {
      console.log('[state-cleanup] Plugin initialized with strategy: on-complete')
    }
  }

  // Cleanup immediately after each step completes
  else if (cleanup.strategy === 'immediate') {
    unsubs.push(onType('step.completed', async (event) => {
      const flowId = event.runId
      if (!flowId) return

      try {
        const sp = getStateProvider()
        const prefix = `flow:${flowId}:`
        const { keys } = await sp.list(prefix)

        if (keys.length > 0) {
          await Promise.all(keys.map((k: string) => sp.delete(k.replace(prefix, ''))))

          if (process.env.NQ_DEBUG_STATE === '1') {
            console.log(`[state-cleanup] Cleaned up ${keys.length} state keys after step completion (immediate strategy)`)
          }
        }
      }
      catch (error) {
        console.error(`[state-cleanup] Error cleaning up state after step:`, error)
      }
    }))

    if (process.env.NQ_DEBUG_STATE === '1') {
      console.log('[state-cleanup] Plugin initialized with strategy: immediate')
    }
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
