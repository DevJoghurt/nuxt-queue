/**
 * PostgreSQL LISTEN/NOTIFY Stream Adapter for nvent
 *
 * Uses PostgreSQL's built-in pub/sub functionality (LISTEN/NOTIFY)
 * Includes gateway pattern to minimize database connections
 */

import type { StreamAdapter, StreamEvent, SubscriptionHandle } from '#nvent/adapters'
import { useRuntimeConfig, registerStreamAdapter, defineNitroPlugin, useNventLogger } from '#imports'
import { defu } from 'defu'
import { Client, type ClientConfig } from 'pg'

export interface PostgresStreamAdapterOptions {
  connection: ClientConfig | string
  /** Prefix for channels (default: 'nvent') */
  prefix?: string
}

/**
 * Gateway pattern for PostgreSQL LISTEN/NOTIFY
 * Maintains a single dedicated database connection for all subscriptions
 * Routes notifications to channel-specific handlers
 */
class PostgresListenGateway {
  private client: Client
  private channelSubscribers = new Map<string, Set<(message: StreamEvent) => void>>()
  private connected = false
  private connecting = false
  private logger = useNventLogger('postgres-listen-gateway')

  constructor(connectionConfig: ClientConfig | string) {
    this.client = new Client(connectionConfig)

    // Handle connection errors
    this.client.on('error', (err) => {
      this.logger.error('PostgreSQL client error:', err)
      this.connected = false
      // Attempt reconnection after error
      this.reconnect()
    })

    // Handle notifications from PostgreSQL
    this.client.on('notification', (msg) => {
      if (!msg.channel || !msg.payload) return

      const handlers = this.channelSubscribers.get(msg.channel)
      if (!handlers || handlers.size === 0) return

      try {
        const parsed: StreamEvent = JSON.parse(msg.payload)
        // Call all handlers for this channel
        for (const handler of Array.from(handlers)) {
          try {
            handler(parsed)
          }
          catch (err) {
            this.logger.error('Handler error:', err)
          }
        }
      }
      catch (err) {
        this.logger.error('Parse error:', err)
      }
    })
  }

  private async reconnect() {
    if (this.connecting) return

    this.connecting = true
    try {
      await this.ensureConnected()
      // Re-subscribe to all channels
      const channels = Array.from(this.channelSubscribers.keys())
      for (const channel of channels) {
        await this.client.query(`LISTEN ${this.escapeIdentifier(channel)}`)
      }
      this.logger.info('Reconnected and re-subscribed to channels')
    }
    catch (err) {
      this.logger.error('Reconnection failed:', err)
      // Retry after delay
      setTimeout(() => this.reconnect(), 5000)
    }
    finally {
      this.connecting = false
    }
  }

  private escapeIdentifier(identifier: string): string {
    // PostgreSQL channel names: alphanumeric, underscore, colon, hyphen
    // Replace any other characters and quote if needed
    const safe = identifier.replace(/[^\w:-]/g, '_')
    return `"${safe}"`
  }

  private async ensureConnected() {
    if (this.connected) return

    if (this.connecting) {
      // Wait for existing connection attempt
      await new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (this.connected || !this.connecting) {
            clearInterval(checkInterval)
            resolve(void 0)
          }
        }, 100)
      })
      return
    }

    this.connecting = true
    try {
      await this.client.connect()
      this.connected = true
      this.logger.info('Connected to PostgreSQL for LISTEN/NOTIFY')
    }
    catch (err) {
      this.logger.error('Connection failed:', err)
      throw err
    }
    finally {
      this.connecting = false
    }
  }

  /**
   * Subscribe to a channel with a handler
   * Returns unsubscribe function
   */
  async subscribe(channel: string, handler: (message: StreamEvent) => void): Promise<() => void> {
    await this.ensureConnected()

    // Register handler
    const isFirstSubscriber = !this.channelSubscribers.has(channel)
    if (isFirstSubscriber) {
      this.channelSubscribers.set(channel, new Set())
      // LISTEN to PostgreSQL channel if this is the first subscriber
      try {
        await this.client.query(`LISTEN ${this.escapeIdentifier(channel)}`)
        this.logger.debug(`LISTEN ${channel}`)
      }
      catch (err) {
        this.logger.error(`Failed to LISTEN on ${channel}:`, err)
        this.channelSubscribers.delete(channel)
        throw err
      }
    }

    this.channelSubscribers.get(channel)!.add(handler)

    // Return unsubscribe function
    return () => {
      const handlers = this.channelSubscribers.get(channel)
      if (handlers) {
        handlers.delete(handler)

        // If no more handlers for this channel, UNLISTEN from PostgreSQL
        if (handlers.size === 0) {
          this.channelSubscribers.delete(channel)
          this.client.query(`UNLISTEN ${this.escapeIdentifier(channel)}`).catch((err) => {
            this.logger.error(`Failed to UNLISTEN ${channel}:`, err)
          })
          this.logger.debug(`UNLISTEN ${channel}`)
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
   * Get all active channels
   */
  getActiveChannels(): string[] {
    return Array.from(this.channelSubscribers.keys())
  }

  /**
   * Cleanup all subscriptions
   */
  async cleanup() {
    const channels = Array.from(this.channelSubscribers.keys())
    this.channelSubscribers.clear()

    for (const channel of channels) {
      try {
        await this.client.query(`UNLISTEN ${this.escapeIdentifier(channel)}`)
      }
      catch {
        // ignore
      }
    }

    try {
      await this.client.end()
      this.connected = false
    }
    catch {
      // ignore
    }
  }
}

/**
 * PostgreSQL LISTEN/NOTIFY stream adapter
 * Provides real-time messaging using PostgreSQL's pub/sub
 */
export class PostgresStreamAdapter implements StreamAdapter {
  private publishClient: Client
  private gateway: PostgresListenGateway
  private logger = useNventLogger('adapter-stream-postgres')

  constructor(private options: PostgresStreamAdapterOptions) {
    // Separate client for NOTIFY commands
    this.publishClient = new Client(
      typeof options.connection === 'string'
        ? options.connection
        : options.connection,
    )

    // Gateway manages a single dedicated connection for LISTEN
    this.gateway = new PostgresListenGateway(options.connection)
  }

  private getChannelName(topic: string): string {
    // Topic already includes full prefix from useStreamTopics
    // e.g., 'nvent:stream:flow:events:123'
    // PostgreSQL channel names are case-insensitive and limited to 63 chars

    // Replace colons with underscores
    let channel = topic.replace(/:/g, '_')

    // PostgreSQL identifier limit is 63 bytes
    // If channel name is too long, hash it
    if (channel.length > 63) {
      // Create a deterministic hash of the channel name
      // Use first 32 chars + hash of full name to maintain readability
      const hash = this.simpleHash(channel)
      const prefix = channel.substring(0, 32)
      channel = `${prefix}_${hash}`
    }

    return channel
  }

  private simpleHash(str: string): string {
    // Simple hash function for channel names
    // Creates a short, deterministic identifier
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32-bit integer
    }
    // Convert to base36 (0-9, a-z) for readability
    return Math.abs(hash).toString(36)
  }

  async init(): Promise<void> {
    try {
      await this.publishClient.connect()
      this.logger.info('Connected to PostgreSQL for NOTIFY')
    }
    catch (err) {
      this.logger.error('Failed to connect publish client:', err)
      throw err
    }
  }

  async publish(topic: string, event: StreamEvent): Promise<void> {
    const channel = this.getChannelName(topic)
    const payload = JSON.stringify(event)

    try {
      // NOTIFY channel, 'payload'
      // Note: PostgreSQL NOTIFY payload is limited to 8000 bytes
      if (payload.length > 8000) {
        this.logger.warn(`Payload too large for NOTIFY (${payload.length} bytes), truncating`)
      }

      await this.publishClient.query('SELECT pg_notify($1, $2)', [channel, payload])
    }
    catch (err) {
      this.logger.error(`Failed to NOTIFY ${channel}:`, err)
      throw err
    }
  }

  async subscribe(
    topic: string,
    handler: (event: StreamEvent) => void | Promise<void>,
  ): Promise<SubscriptionHandle> {
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
    // PostgreSQL doesn't have a built-in way to list active channels
    // Return the channels we're currently listening to
    return this.gateway.getActiveChannels().map(channel =>
      // Convert back from underscore to colon format
      channel.replace(/_/g, ':'),
    )
  }

  async getSubscriptionCount(topic: string): Promise<number> {
    const channel = this.getChannelName(topic)
    return this.gateway.getSubscriberCount(channel)
  }

  async shutdown(): Promise<void> {
    try {
      await this.gateway.cleanup()
      await this.publishClient.end()
      this.logger.info('Shutdown complete')
    }
    catch (err) {
      this.logger.error('Shutdown error:', err)
    }
  }
}

export default defineNitroPlugin(async (nitroApp: any) => {
  // Listen to the registration hook from nvent
  nitroApp.hooks.hook('nvent:register-adapters' as any, () => {
    const runtimeConfig = useRuntimeConfig()
    const moduleOptions = (runtimeConfig as any).nventStreamPostgres || {}
    const nventConfig = (runtimeConfig as any).nvent || {}

    // Get connection from module options, nvent config, or connections config
    const connection = moduleOptions.connection
      || nventConfig.stream?.connection
      || nventConfig.connections?.postgres

    const logger = useNventLogger('adapter-stream-postgres')

    if (!connection) {
      logger.warn('No PostgreSQL connection config found')
    }

    const config = defu(moduleOptions, {
      connection,
      prefix: nventConfig.stream?.prefix || 'nvent',
    })

    // Create and register adapter
    const adapter = new PostgresStreamAdapter({
      connection: config.connection,
      prefix: config.prefix,
    })

    registerStreamAdapter('postgres', adapter)

    logger.info('PostgreSQL stream adapter registered')
  })
})
