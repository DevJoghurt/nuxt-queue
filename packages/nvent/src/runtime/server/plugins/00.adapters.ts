/**
 * Adapter Initialization Plugin (v0.4.1)
 *
 * Initializes the three-adapter architecture with new config format:
 * - QueueAdapter: Job queue operations (from config.queue)
 * - StreamAdapter: Cross-instance pub/sub messaging (from config.stream)
 * - StoreAdapter: Storage - events, documents, KV, indices (from config.store)
 *
 * Uses normalized config with connection fallback from connections.*
 */

import { defineNitroPlugin, useRuntimeConfig, useNventLogger, setAdapters } from '#imports'
import { createAdapters, shutdownAdapters } from '../../adapters/factory'
import type { QueueModuleConfig } from '../../config/types'
import { createWiringRegistry } from '../../events/wiring/registry'

export default defineNitroPlugin(async (nitroApp) => {
  const logger = useNventLogger('adapters-plugin')
  const runtimeConfig = useRuntimeConfig()
  const config = (runtimeConfig as any).nvent as QueueModuleConfig

  if (!config) {
    logger.error('No nvent config found in runtime config')
    throw new Error('Missing nvent configuration')
  }

  logger.info('Initializing adapters', {
    queue: config.queue?.adapter || 'file',
    stream: config.stream?.adapter || 'memory',
    store: config.store?.adapter || 'file',
  })

  try {
    // Create and initialize all adapters with new config format
    const adapters = await createAdapters({
      queue: config.queue,
      stream: config.stream,
      store: config.store,
    })

    // Set global adapters for use via setAdapters utilities
    setAdapters(adapters)

    logger.info('Adapters initialized successfully', {
      queueAdapter: config.queue.adapter,
      streamAdapter: config.stream.adapter,
      storeAdapter: config.store.adapter,
    })

    // Notify other plugins that adapters are ready
    await nitroApp.hooks.callHook('nvent:adapters:ready' as any)

    // 4. Initialize flow wiring (event handlers)
    const wiring = createWiringRegistry({
      streamWiring: {
        enabled: true, // Enable for WebSocket support
      },
      stateWiring: {
        // Strategy is read from config by default (queue.store.state.cleanup.strategy)
        // Can be overridden here if needed
      },
    })
    wiring.start()
    logger.info('Flow wiring started')

    return {
      hooks: {
        close: async () => {
          logger.info('Shutting down')
          try {
            // Stop wiring first
            wiring.stop()
            logger.info('Flow wiring stopped')

            // Then shutdown adapters
            await shutdownAdapters(adapters)
            logger.info('Adapters shut down successfully')
          }
          catch (error) {
            logger.error('Error during shutdown', { error })
          }
        },
      },
    }
  }
  catch (error) {
    logger.error('Failed to initialize adapters', { error })
    throw error
  }
})
