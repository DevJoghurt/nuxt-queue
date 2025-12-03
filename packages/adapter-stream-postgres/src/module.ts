/**
 * PostgreSQL Stream Adapter Module for nvent
 *
 * Registers PostgreSQL LISTEN/NOTIFY-based stream adapter with nvent
 */

import { defineNuxtModule, useLogger, addServerPlugin, createResolver } from '@nuxt/kit'
import type { PostgresStreamAdapterOptions } from './runtime/adapter'

export interface ModuleOptions extends PostgresStreamAdapterOptions {
  /**
   * Enable the adapter
   * @default true
   */
  enabled?: boolean
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: '@nvent/adapter-stream-postgres',
    configKey: 'nventStreamPostgres',
  },
  defaults: {
    enabled: true,
  },
  setup(options, nuxt) {
    if (!options.enabled) {
      return
    }

    const logger = useLogger('@nvent/adapter-stream-postgres')
    const { resolve } = createResolver(import.meta.url)

    logger.info('Setting up PostgreSQL stream adapter module')

    // Store module options in runtime config so the plugin can access them
    nuxt.options.runtimeConfig.nventStreamPostgres = {
      ...options,
    }

    // Add Nitro plugin that registers the adapter
    addServerPlugin(resolve('./runtime/adapter'))
  },
})
