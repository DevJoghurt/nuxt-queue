import type { StreamAdapter, StreamEvent, SubscriptionHandle } from '#nvent/adapters'
import { useRuntimeConfig, registerStreamAdapter, defineNitroPlugin } from '#imports'
import { defu } from 'defu'
import type IORedis from 'ioredis'
import IORedisConstructor from 'ioredis'

export interface RedisStreamAdapterOptions {
  connection: {
    host?: string
    port?: number
    username?: string
    password?: string
    db?: number
  }
  /** Prefix for channels (default: 'nq') */
  prefix?: string
}

/**
 * Gateway pattern for Redis Pub/Sub
 * Maintains a single 'message' listener and routes to channel-specific handlers
 */
class RedisPubSubGateway {
  private channelSubscribers = new Map<string, Set<(message: StreamEvent) => void>>()
  private initialized = false

  constructor(private subscriber: IORedis) {}

  private initialize() {
    if (this.initialized) return
    this.initialized = true

    // Single message handler for all channels
    this.subscriber.on('message', (channel: string, message: string) => {
      const handlers = this.channelSubscribers.get(channel)
      if (!handlers || handlers.size === 0) return

      try {
        const parsed: StreamEvent = JSON.parse(message)
        // Call all handlers for this channel
        for (const handler of Array.from(handlers)) {
          try {
            handler(parsed)
          }
          catch (err) {
            console.error('[RedisPubSubGateway] Handler error:', err)
          }
        }
      }
      catch (err) {
        console.error('[RedisPubSubGateway] Parse error:', err)
      }
    })
  }

  /**
   * Subscribe to a channel with a handler
   * Returns unsubscribe function
   */
  async subscribe(channel: string, handler: (message: StreamEvent) => void): Promise<() => void> {
    this.initialize()

    // Register handler
    if (!this.channelSubscribers.has(channel)) {
      this.channelSubscribers.set(channel, new Set())
      // Subscribe to Redis channel if this is the first subscriber
      await this.subscriber.subscribe(channel)
    }
    this.channelSubscribers.get(channel)!.add(handler)

    // Return unsubscribe function
    return () => {
      const handlers = this.channelSubscribers.get(channel)
      if (handlers) {
        handlers.delete(handler)

        // If no more handlers for this channel, unsubscribe from Redis
        if (handlers.size === 0) {
          this.channelSubscribers.delete(channel)
          this.subscriber.unsubscribe(channel).catch(() => {
            // ignore
          })
        }
      }
    }
  }

  /**
   * Get subscriber count for a channel (for debugging)
   */
  getSubscriberCount(channel: string): number {
    return this.channelSubscribers.get(channel)?.size ?? 0
  }

  /**
   * Get total subscriber count across all channels
   */
  getTotalSubscriberCount(): number {
    let count = 0
    for (const handlers of Array.from(this.channelSubscribers.values())) {
      count += handlers.size
    }
    return count
  }

  /**
   * Cleanup all subscriptions
   */
  async cleanup() {
    const channels = Array.from(this.channelSubscribers.keys())
    this.channelSubscribers.clear()

    if (channels.length > 0) {
      await this.subscriber.unsubscribe(...channels).catch(() => {
        // ignore
      })
    }
  }
}

/**
 * Redis Pub/Sub stream adapter
 * Provides real-time messaging using Redis channels
 */
export class RedisStreamAdapter implements StreamAdapter {
  private redis: IORedis
  private gateway: RedisPubSubGateway

  constructor(private options: RedisStreamAdapterOptions) {
    const conn = options.connection
    
    console.log('[adapter-stream-redis] Initializing with connection:', {
      host: conn?.host || 'localhost',
      port: conn?.port || 6379,
      hasPassword: !!conn?.password,
      db: conn?.db || 0,
    })
    
    this.redis = new IORedisConstructor({
      host: conn?.host || 'localhost',
      port: conn?.port || 6379,
      username: conn?.username,
      password: conn?.password,
      db: conn?.db || 0,
      lazyConnect: true,
      enableReadyCheck: false,
      retryStrategy: (times) => {
        if (times > 3) {
          console.error('[adapter-stream-redis] Failed to connect after 3 attempts')
          return null // Stop retrying
        }
        console.log(`[adapter-stream-redis] Retry attempt ${times}`)
        return Math.min(times * 100, 3000)
      },
    })

    // Handle connection errors
    this.redis.on('error', (err) => {
      console.error('[adapter-stream-redis] Redis connection error:', err.message)
    })
    
    this.redis.on('connect', () => {
      console.log('[adapter-stream-redis] Connected to Redis')
    })

    // Create dedicated subscriber connection for Pub/Sub
    const subscriber = new IORedisConstructor({
      host: conn.host || 'localhost',
      port: conn.port || 6379,
      username: conn.username,
      password: conn.password,
      db: conn.db || 0,
      lazyConnect: true,
      enableReadyCheck: false,
      retryStrategy: (times) => {
        if (times > 3) {
          console.error('[adapter-stream-redis] Subscriber failed to connect after 3 attempts')
          return null // Stop retrying
        }
        return Math.min(times * 100, 3000)
      },
    })

    // Handle subscriber connection errors
    subscriber.on('error', (err) => {
      console.error('[adapter-stream-redis] Redis subscriber error:', err.message)
    })

    // Create gateway to manage pub/sub subscriptions efficiently
    this.gateway = new RedisPubSubGateway(subscriber)
  }

  private getChannelName(topic: string): string {
    // Topic already includes full prefix from useStreamTopics
    // e.g., 'nvent:stream:flow:events:123'
    return topic
  }

  async init(): Promise<void> {
    // Lazy connection on first use
  }

  async publish(topic: string, event: StreamEvent): Promise<void> {
    if (!this.redis.status || this.redis.status === 'end') {
      await this.redis.connect()
    }

    const channel = this.getChannelName(topic)
    await this.redis.publish(channel, JSON.stringify(event))
  }

  async subscribe(
    topic: string,
    handler: (event: StreamEvent) => void | Promise<void>,
  ): Promise<SubscriptionHandle> {
    if (!this.redis.status || this.redis.status === 'end') {
      await this.redis.connect()
    }

    const channel = this.getChannelName(topic)
    const id = `${topic}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    // Use the gateway to subscribe
    const unsubscribeFn = await this.gateway.subscribe(channel, handler)

    return {
      id,
      topic,
      unsubscribe: async () => {
        unsubscribeFn()
      },
    }
  }

  async unsubscribe(handle: SubscriptionHandle): Promise<void> {
    await handle.unsubscribe()
  }

  async listTopics(): Promise<string[]> {
    if (!this.redis.status || this.redis.status === 'end') {
      await this.redis.connect()
    }

    const prefix = this.options.prefix || 'nvent'
    const pattern = `${prefix}:stream:*`

    // Use PUBSUB CHANNELS to list active channels
    const channels = await this.redis.pubsub('CHANNELS', pattern) as string[]
    // Return full channel names (topics include prefix from useStreamTopics)
    return channels.filter(ch => ch.startsWith(`${prefix}:stream:`))
  }

  async getSubscriptionCount(topic: string): Promise<number> {
    if (!this.redis.status || this.redis.status === 'end') {
      await this.redis.connect()
    }

    const channel = this.getChannelName(topic)
    const result = await this.redis.pubsub('NUMSUB', channel) as any[]

    // PUBSUB NUMSUB returns [channel1, count1, channel2, count2, ...]
    for (let i = 0; i < result.length; i += 2) {
      if (result[i] === channel) {
        return Number(result[i + 1]) || 0
      }
    }

    return 0
  }

  async shutdown(): Promise<void> {
    try {
      await this.gateway.cleanup()
      await this.redis.quit()
    }
    catch {
      // ignore
    }
  }
}

export default defineNitroPlugin(async (nitroApp) => {
  // Listen to the registration hook from nvent
  nitroApp.hooks.hook('nvent:register-adapters' as any, () => {
    const runtimeConfig = useRuntimeConfig()
    const moduleOptions = (runtimeConfig as any).nventStreamRedis || {}
    const nventConfig = (runtimeConfig as any).nvent || {}

    // Get connection from module options, nvent config, or connections config
    const connection = moduleOptions.connection
      || nventConfig.stream?.connection
      || nventConfig.connections?.redis

    console.log('[adapter-stream-redis] DEBUG - connection source:', {
      moduleOptions: moduleOptions.connection,
      streamConnection: nventConfig.stream?.connection,
      redisConnection: nventConfig.connections?.redis,
      finalConnection: connection,
    })

    if (!connection) {
      console.error('[adapter-stream-redis] No Redis connection config found. Please configure Redis connection in your nuxt.config.ts:')
      console.error('  nvent: {')
      console.error('    connections: {')
      console.error('      redis: {')
      console.error('        host: process.env.REDIS_HOST || "localhost",')
      console.error('        port: parseInt(process.env.REDIS_PORT || "6379"),')
      console.error('        // password: process.env.REDIS_PASSWORD,')
      console.error('      }')
      console.error('    }')
      console.error('  }')
      throw new Error('[adapter-stream-redis] Redis connection configuration is required')
    }

    const config = defu(moduleOptions, {
      connection,
      prefix: nventConfig.stream?.prefix || 'nvent',
    })

    console.log(`[adapter-stream-redis] Connecting to Redis at ${config.connection.host}:${config.connection.port}`)

    // Create and register adapter
    const adapter = new RedisStreamAdapter({
      connection: config.connection,
      prefix: config.prefix,
    })

    registerStreamAdapter('redis', adapter)

    console.log('[adapter-stream-redis] Redis stream adapter registered')
  })
})
