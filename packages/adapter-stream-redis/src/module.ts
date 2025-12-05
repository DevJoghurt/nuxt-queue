import { defineNuxtModule, createResolver, addServerPlugin } from '@nuxt/kit'
import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'))

export interface ModuleOptions {
  connection?: {
    host?: string
    port?: number
    username?: string
    password?: string
    db?: number
  }
  prefix?: string
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: '@nvent/adapter-stream-redis',
    version: packageJson.version,
    configKey: 'nventStreamRedis',
  },
  defaults: {
    connection: {
      host: 'localhost',
      port: 6379,
    },
    prefix: 'nvent',
  },
  setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url)

    // Store module options in runtime config
    nuxt.options.runtimeConfig.nventStreamRedis = {
      ...options,
    }

    // Add Nitro plugin that registers the adapter
    addServerPlugin(resolve('./runtime/adapter'))
  },
})
