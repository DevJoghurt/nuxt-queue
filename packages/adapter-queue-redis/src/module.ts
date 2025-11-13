/**
 * Redis Queue Adapter Module for nvent
 *
 * Registers BullMQ-based Redis queue adapter with nvent
 */

import { defineNuxtModule, useLogger } from '@nuxt/kit'
import { RedisQueueAdapter } from './adapter'
import type { RedisQueueAdapterOptions } from './adapter'

export interface ModuleOptions extends RedisQueueAdapterOptions {
  /**
   * Enable the adapter
   * @default true
   */
  enabled?: boolean
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: '@nvent/adapter-queue-redis',
    configKey: 'nventQueueRedis',
  },
  defaults: {
    enabled: true,
  },
  setup(options, nuxt) {
    if (!options.enabled) {
      return
    }

    const logger = useLogger('@nvent/adapter-queue-redis')

    // Register adapter with nvent via hook
    nuxt.hook('nvent:registerAdapter', (registry: any, config: any) => {
      logger.info('Registering Redis queue adapter')

      // Get connection config from nvent config or module options
      const connection = options.connection || config.queue?.redis

      if (!connection) {
        logger.warn('No Redis connection config found, adapter may not work correctly')
      }

      // Create adapter instance
      const adapter = new RedisQueueAdapter({
        connection,
        prefix: options.prefix || config.queue?.defaultConfig?.prefix,
        defaultJobOptions: options.defaultJobOptions || config.queue?.defaultConfig?.defaultJobOptions,
      })

      // Register with nvent adapter registry
      registry.registerQueue('redis', adapter)

      logger.success('Redis queue adapter registered')
    })
  },
})
