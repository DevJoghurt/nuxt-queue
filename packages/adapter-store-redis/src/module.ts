import { defineNuxtModule } from '@nuxt/kit'
import { defu } from 'defu'
import { RedisStoreAdapter } from './adapter'

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
    // Register the Redis store adapter
    nuxt.hook('nvent:registerAdapter', (registry: any) => {
      // Allow configuration from nvent config as well
      const nventConfig = nuxt.options.runtimeConfig.nvent || {}
      const storeConfig = nventConfig.store || {}
      const redisConfig = storeConfig.redis || {}

      const config = defu(
        options,
        redisConfig,
        {
          connection: { host: 'localhost', port: 6379 },
          prefix: 'nq',
          streams: { trim: { maxLen: 10000, approx: true } },
        },
      )

      const adapter = new RedisStoreAdapter({
        connection: config.connection!,
        prefix: config.prefix,
        streams: config.streams,
      })

      registry.registerStore('redis', adapter)
    })
  },
})
