import { defineNuxtModule } from '@nuxt/kit'
import { defu } from 'defu'
import { RedisStreamAdapter } from './adapter'

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
    // Register the Redis stream adapter
    nuxt.hook('nvent:registerAdapter', (registry: any) => {
      // Allow configuration from nvent config as well
      const nventConfig = nuxt.options.runtimeConfig.nvent || {}
      const streamConfig = nventConfig.stream || {}
      const redisConfig = streamConfig.redis || {}

      const config = defu(
        options,
        redisConfig,
        {
          connection: { host: 'localhost', port: 6379 },
          prefix: 'nq',
        },
      )

      const adapter = new RedisStreamAdapter({
        connection: config.connection!,
        prefix: config.prefix,
      })

      registry.registerStream('redis', adapter)
    })
  },
})
