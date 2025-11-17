import { defineNuxtModule, createResolver, addServerPlugin } from '@nuxt/kit'
import { defu } from 'defu'
import { RedisStreamAdapter } from './runtime/adapter'

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
    configKey: 'nventStreamRedis',
  },
  defaults: {
    connection: {
      host: 'localhost',
      port: 6379,
    },
    prefix: 'nq',
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
