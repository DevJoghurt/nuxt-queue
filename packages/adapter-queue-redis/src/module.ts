/**
 * Redis Queue Adapter Module for nvent
 *
 * Registers BullMQ-based Redis queue adapter with nvent
 */

import { defineNuxtModule, useLogger, addServerPlugin, createResolver } from '@nuxt/kit'
import { RedisQueueAdapter } from './runtime/adapter'
import type { RedisQueueAdapterOptions } from './runtime/adapter'

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
    const { resolve } = createResolver(import.meta.url)

    logger.info('Setting up Redis queue adapter module')

    // Store module options in runtime config so the plugin can access them
    nuxt.options.runtimeConfig.nventQueueRedis = {
      ...options,
    }

    // Add Nitro plugin that registers the adapter
    // Named with -1 to ensure it runs before the main 00.adapters.ts plugin
    addServerPlugin(resolve('./runtime/adapter'))
  },
})
