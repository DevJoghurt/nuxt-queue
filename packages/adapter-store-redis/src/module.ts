import { defineNuxtModule, createResolver, addServerPlugin } from '@nuxt/kit'

export interface ModuleOptions {
  connection?: {
    host?: string
    port?: number
    username?: string
    password?: string
    db?: number
  }
  prefix?: string
  streams?: {
    group?: string
    consumer?: string
    trim?: {
      maxLen?: number
      approx?: boolean
    }
  }
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: '@nvent/adapter-store-redis',
    configKey: 'nventStoreRedis',
  },
  defaults: {
    connection: {
      host: 'localhost',
      port: 6379,
    },
    prefix: 'nq',
    streams: {
      trim: {
        maxLen: 10000,
        approx: true,
      },
    },
  },
  setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url)

    // Store module options in runtime config
    nuxt.options.runtimeConfig.nventStoreRedis = {
      ...options,
    }

    // Add Nitro plugin that registers the adapter
    addServerPlugin(resolve('./runtime/adapter'))
  },
})
