import { defineNuxtModule, createResolver, addServerPlugin } from '@nuxt/kit'
import type { PoolConfig } from 'pg'
import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'))

export interface ModuleOptions {
  connection?: PoolConfig | string
  prefix?: string
  autoMigrate?: boolean
  poolSize?: number
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: '@nvent-addon/adapter-store-postgres',
    version: packageJson.version,
    configKey: 'nventStorePostgres',
  },
  defaults: {
    prefix: 'nvent',
    autoMigrate: true,
    poolSize: 10,
  },
  setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url)

    // Get connection config from nvent.connections.postgres if available
    const nventConfig = nuxt.options.runtimeConfig.public?.nvent || (nuxt.options as any).nvent
    const postgresConnection = nventConfig?.connections?.postgres

    // Store module options in runtime config with merged connection
    nuxt.options.runtimeConfig.nventStorePostgres = {
      ...options,
      connection: options.connection || postgresConnection || {
        host: 'localhost',
        port: 5432,
        database: 'nvent',
        user: 'postgres',
        password: 'postgres',
      },
    }

    // Add Nitro plugin that registers the adapter
    addServerPlugin(resolve('./runtime/adapter'))
  },
})
