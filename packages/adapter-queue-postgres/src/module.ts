/**
 * PostgreSQL Queue Adapter Module for nvent
 *
 * Registers pg-boss-based PostgreSQL queue adapter with nvent
 */

import { defineNuxtModule, useLogger, addServerPlugin, createResolver } from '@nuxt/kit'
import type { PostgresQueueAdapterOptions } from './runtime/adapter'
import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'))

export interface ModuleOptions extends PostgresQueueAdapterOptions {
  /**
   * Enable the adapter
   * @default true
   */
  enabled?: boolean
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: '@nvent/adapter-queue-postgres',
    version: packageJson.version,
    configKey: 'nventQueuePostgres',
  },
  defaults: {
    enabled: true,
  },
  setup(options, nuxt) {
    if (!options.enabled) {
      return
    }

    const logger = useLogger('@nvent/adapter-queue-postgres')
    const { resolve } = createResolver(import.meta.url)

    logger.info('Setting up PostgreSQL queue adapter module')

    // Store module options in runtime config so the plugin can access them
    nuxt.options.runtimeConfig.nventQueuePostgres = {
      ...options,
    }

    // Add Nitro plugin that registers the adapter
    // Named with -1 to ensure it runs before the main 00.adapters.ts plugin
    addServerPlugin(resolve('./runtime/adapter'))
  },
})
