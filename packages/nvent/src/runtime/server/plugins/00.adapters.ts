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

import { defineNitroPlugin, useRuntimeConfig, useServerLogger } from '#imports'
import { createAdapters, shutdownAdapters } from '../adapters/factory'
import { setAdapters } from '../utils/useAdapters'
import type { QueueModuleConfig } from '../../../config/types'

const logger = useServerLogger('adapters-plugin')

export default defineNitroPlugin(async (nitroApp) => {
  const runtimeConfig = useRuntimeConfig()
  const config = (runtimeConfig as any).queue as QueueModuleConfig

  if (!config) {
    logger.error('No queue config found in runtime config')
    throw new Error('Missing queue configuration')
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

    // Set global adapters for use via useAdapters utilities
    setAdapters(adapters)

    logger.info('Adapters initialized successfully', {
      queueAdapter: config.queue.adapter,
      streamAdapter: config.stream.adapter,
      storeAdapter: config.store.adapter,
    })

    // Notify other plugins that adapters are ready
    await nitroApp.hooks.callHook('nvent:adapters:ready' as any)

    // 4. Initialize flow wiring (event handlers)
    const { createWiringRegistry } = await import('../events/wiring/registry')
    const wiring = createWiringRegistry()
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
