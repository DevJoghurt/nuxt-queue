import type { StoreAdapter, EventRecord, EventReadOptions, ListOptions } from '#nvent/adapters'
import { useRuntimeConfig, registerStoreAdapter, defineNitroPlugin } from '#imports'
import { defu } from 'defu'
import IORedis from 'ioredis'

export interface RedisStoreAdapterOptions {
  connection: {
    host?: string
    port?: number
    username?: string
    password?: string
    db?: number
  }
  /** Prefix for keys (default: 'nq') */
  prefix?: string
  /** Options for Redis Streams */
  streams?: {
    trim?: {
      maxLen?: number
      approx?: boolean
    }
  }
}

/**
 * Redis store adapter using Redis Streams for event storage
 * Implements the three-tier storage interface:
 * - Event Stream: Redis Streams (XADD/XRANGE)
 * - Sorted Index: Redis Sorted Sets (ZADD/ZRANGE)
 * - Key-Value Store: Redis Strings
 */
export class RedisStoreAdapter implements StoreAdapter {
  private redis: IORedis
  private prefix: string
  private streamOptions: NonNullable<RedisStoreAdapterOptions['streams']>
  public kv: StoreAdapter['kv']

  constructor(private options: RedisStoreAdapterOptions) {
    const conn = options.connection
    this.redis = new IORedis({
      host: conn.host || 'localhost',
      port: conn.port || 6379,
      username: conn.username,
      password: conn.password,
      db: conn.db || 0,
      lazyConnect: true,
      enableReadyCheck: false,
    })

    this.prefix = options.prefix || 'nq'
    this.streamOptions = options.streams || {}

    // Initialize KV store methods
    this.kv = {
      get: async <T = any>(key: string): Promise<T | null> => {
        if (!this.redis.status || this.redis.status === 'end') {
          await this.redis.connect()
        }

        const fullKey = `${this.prefix}:kv:${key}`
        const data = await this.redis.get(fullKey)
        if (!data) return null

        try {
          return JSON.parse(data) as T
        }
        catch {
          return data as T
        }
      },

      set: async <T = any>(key: string, value: T, ttl?: number): Promise<void> => {
        if (!this.redis.status || this.redis.status === 'end') {
          await this.redis.connect()
        }

        const fullKey = `${this.prefix}:kv:${key}`
        const serialized = typeof value === 'string' ? value : JSON.stringify(value)

        if (ttl) {
          await this.redis.setex(fullKey, ttl, serialized)
        }
        else {
          await this.redis.set(fullKey, serialized)
        }
      },

      delete: async (key: string): Promise<void> => {
        if (!this.redis.status || this.redis.status === 'end') {
          await this.redis.connect()
        }

        const fullKey = `${this.prefix}:kv:${key}`
        await this.redis.del(fullKey)
      },

      clear: async (pattern: string): Promise<number> => {
        if (!this.redis.status || this.redis.status === 'end') {
          await this.redis.connect()
        }

        const fullPattern = `${this.prefix}:kv:${pattern}`
        let cursor = '0'
        const keysToDelete: string[] = []

        do {
          const result = await this.redis.scan(cursor, 'MATCH', fullPattern, 'COUNT', 100)
          cursor = result[0]
          const keys = result[1]
          if (keys.length > 0) {
            keysToDelete.push(...keys)
          }
        } while (cursor !== '0')

        if (keysToDelete.length > 0) {
          await this.redis.del(...keysToDelete)
        }

        return keysToDelete.length
      },

      increment: async (key: string, by: number = 1): Promise<number> => {
        if (!this.redis.status || this.redis.status === 'end') {
          await this.redis.connect()
        }

        // For document field increments, key format: 'collection:id:field'
        // This allows atomic HINCRBY operations on hash fields
        const parts = key.split(':')
        if (parts.length >= 3) {
          // Extract collection:id and field
          const field = parts.pop()!
          const hashKey = parts.join(':')

          // Use HINCRBY for atomic increment on hash field
          const newValue = await this.redis.hincrby(hashKey, field, by)

          // Also increment version for consistency
          await this.redis.hincrby(hashKey, 'version', 1)

          return newValue
        }

        // Fallback to simple INCRBY for non-hash keys
        const fullKey = `${this.prefix}:kv:${key}`
        return await this.redis.incrby(fullKey, by)
      },
    }
  }

  private buildFields(data: any): string[] {
    const fields: string[] = []
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue
      fields.push(key)
      if (typeof value === 'object') {
        fields.push(JSON.stringify(value))
      }
      else {
        fields.push(String(value))
      }
    }
    return fields
  }

  private parseFields(arr: string[]): any {
    const obj: Record<string, any> = {}
    for (let i = 0; i < arr.length; i += 2) {
      const key = arr[i]
      const value = arr[i + 1]

      try {
        obj[key] = JSON.parse(value)
      }
      catch {
        obj[key] = value
      }
    }
    return obj
  }

  /**
   * Generic hash field parser - attempts to deserialize values intelligently
   * - Tries JSON parse for arrays/objects
   * - Tries number parse for numeric strings
   * - Falls back to string
   */
  private parseHashFields(hash: Record<string, string>): Record<string, any> {
    const flat: Record<string, any> = {}

    // First parse all values
    for (const [k, v] of Object.entries(hash)) {
      // Try JSON parse first (for arrays)
      if (v.startsWith('[')) {
        try {
          flat[k] = JSON.parse(v)
          continue
        }
        catch {
          // Not valid JSON, continue
        }
      }

      // Try number parse (integers and floats)
      const num = Number(v)
      if (!Number.isNaN(num) && v.trim() !== '') {
        flat[k] = num
        continue
      }

      // Keep as string
      flat[k] = v
    }

    // Reconstruct nested structure from dot notation
    const result: Record<string, any> = {}
    for (const [key, value] of Object.entries(flat)) {
      if (key === 'version') {
        result[key] = value
        continue
      }

      if (key.includes('.')) {
        const keys = key.split('.')
        let current = result

        for (let i = 0; i < keys.length - 1; i++) {
          const k = keys[i]
          if (!current[k]) {
            current[k] = {}
          }
          current = current[k]
        }

        current[keys[keys.length - 1]] = value
      }
      else {
        result[key] = value
      }
    }

    return result
  }

  /**
   * Expand dot notation to nested objects before serialization
   * e.g., { 'stats.totalFires': 5 } -> { stats: { totalFires: 5 } }
   */
  private expandDotNotation(obj: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {}

    for (const [key, value] of Object.entries(obj)) {
      if (key === 'version') {
        result[key] = value
        continue
      }

      if (key.includes('.')) {
        const keys = key.split('.')
        let current = result

        for (let i = 0; i < keys.length - 1; i++) {
          const k = keys[i]
          if (!current[k]) {
            current[k] = {}
          }
          current = current[k]
        }

        current[keys[keys.length - 1]] = value
      }
      else {
        result[key] = value
      }
    }

    return result
  }

  /**
   * Flatten nested objects to dot notation for Redis hash storage
   * e.g., { stats: { totalFires: 5 } } -> { 'stats.totalFires': 5 }
   */
  private flattenToHashFields(obj: Record<string, any>, prefix = ''): Record<string, any> {
    const result: Record<string, any> = {}

    for (const [key, value] of Object.entries(obj)) {
      const newKey = prefix ? `${prefix}.${key}` : key

      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        // Recursively flatten nested objects
        Object.assign(result, this.flattenToHashFields(value, newKey))
      }
      else {
        result[newKey] = value
      }
    }

    return result
  }

  /**
   * Serialize values for Redis hash storage
   * - Nested objects → Flattened with dot notation
   * - Arrays → JSON
   * - Others → String
   */
  private serializeHashFields(obj: Record<string, any>): Record<string, string> {
    // First expand any dot notation, then flatten to ensure consistency
    const expanded = this.expandDotNotation(obj)
    const flattened = this.flattenToHashFields(expanded)

    const serialized: Record<string, string> = {}

    for (const [k, v] of Object.entries(flattened)) {
      if (v === undefined) continue

      if (Array.isArray(v)) {
        // Filter out null/undefined from arrays and serialize
        serialized[k] = JSON.stringify(v.filter(item => item != null))
      }
      else {
        serialized[k] = String(v)
      }
    }

    return serialized
  }

  // ============================================================
  // Event Stream Methods
  // ============================================================

  async append(subject: string, event: Omit<EventRecord, 'id' | 'ts'>): Promise<EventRecord> {
    if (!this.redis.status || this.redis.status === 'end') {
      await this.redis.connect()
    }

    const ts = Date.now()
    const data = { ...event, ts }
    const fields = this.buildFields(data)

    // Use subject directly as stream key (e.g., 'nq:flow:runId')
    const streamKey = subject

    let id: string
    const trim = this.streamOptions.trim
    if (trim?.maxLen && trim.maxLen > 0) {
      const approx = trim.approx !== false
      const args = approx ? ['MAXLEN', '~', String(trim.maxLen)] : ['MAXLEN', String(trim.maxLen)]
      id = await (this.redis as any).xadd(streamKey, ...args, '*', ...fields)
    }
    else {
      id = await (this.redis as any).xadd(streamKey, '*', ...fields)
    }

    return { ...data, id } as EventRecord
  }

  async read(subject: string, opts?: EventReadOptions): Promise<EventRecord[]> {
    if (!this.redis.status || this.redis.status === 'end') {
      await this.redis.connect()
    }

    // Use subject directly as stream key (e.g., 'nq:flow:runId')
    const streamKey = subject

    // Determine start/end based on options
    let start = '-'
    let end = '+'
    const limit = opts?.limit || 1000
    const order = opts?.order || 'asc'

    if (opts?.after) {
      start = `(${opts.after}` // Exclusive
    }
    else if (opts?.from) {
      // Convert timestamp to stream ID (timestamp-0)
      start = `${opts.from}-0`
    }

    if (opts?.before) {
      end = `(${opts.before}` // Exclusive
    }
    else if (opts?.to) {
      end = `${opts.to}-0`
    }

    let resp: any[]
    if (order === 'desc') {
      // For descending, swap start and end
      resp = await (this.redis as any).xrevrange(streamKey, end === '+' ? '+' : end, start === '-' ? '-' : start, 'COUNT', limit)
    }
    else {
      resp = await (this.redis as any).xrange(streamKey, start, end, 'COUNT', limit)
    }

    const records: EventRecord[] = []
    for (const [id, arr] of resp) {
      try {
        const fields = this.parseFields(arr)
        const record: EventRecord = {
          id,
          ts: fields.ts || 0,
          type: fields.type || 'unknown',
          runId: fields.runId,
          flowName: fields.flowName,
          stepName: fields.stepName,
          stepId: fields.stepId,
          attempt: fields.attempt,
          data: fields.data,
        }

        // Filter by type if specified
        if (opts?.types && opts.types.length > 0) {
          if (!opts.types.includes(record.type)) {
            continue
          }
        }

        records.push(record)
      }
      catch {
        // ignore malformed entries
      }
    }

    return records
  }

  // ============================================================
  // Sorted Index Methods (optional)
  // ============================================================

  /**
   * Add entry to sorted index
   * @param key - Sorted set key (e.g., 'nq:flows:flowName')
   * @param id - Entry ID (member in sorted set)
   * @param score - Sort score (typically timestamp)
   * @param metadata - Optional metadata stored in hash at key:meta:id
   */
  async indexAdd(key: string, id: string, score: number, metadata?: Record<string, any>): Promise<void> {
    if (!this.redis.status || this.redis.status === 'end') {
      await this.redis.connect()
    }

    // Add to sorted set for time-ordered listing
    await this.redis.zadd(key, score, id)

    // Store metadata in hash if provided at key:meta:id
    if (metadata) {
      const metaKey = `${key}:meta:${id}`
      // Initialize with version 0 for optimistic locking support
      const metaToStore = { version: 0, ...metadata }
      const serialized = this.serializeHashFields(metaToStore)
      await this.redis.hset(metaKey, serialized)
    }
  }

  async indexGet(key: string, id: string): Promise<{ id: string, score: number, metadata?: any } | null> {
    if (!this.redis.status || this.redis.status === 'end') {
      await this.redis.connect()
    }

    // Get score from sorted set
    const score = await this.redis.zscore(key, id)
    if (!score) return null

    // Fetch metadata from hash at key:meta:id
    const metaKey = `${key}:meta:${id}`
    const rawMetadata = await this.redis.hgetall(metaKey)

    if (Object.keys(rawMetadata).length === 0) {
      return { id, score: Number.parseFloat(score) }
    }

    // Use generic parser to deserialize all fields
    const metadata = this.parseHashFields(rawMetadata)

    return {
      id,
      score: Number.parseFloat(score),
      metadata,
    }
  }

  async indexRead(key: string, opts?: { offset?: number, limit?: number }): Promise<Array<{ id: string, score: number, metadata?: any }>> {
    if (!this.redis.status || this.redis.status === 'end') {
      await this.redis.connect()
    }

    const offset = opts?.offset || 0
    const limit = opts?.limit || 50
    const end = offset + limit - 1

    // Read from sorted set in reverse order (newest first) with scores
    const results = await this.redis.zrevrange(key, offset, end, 'WITHSCORES')

    // Results alternate between member and score
    const entries: Array<{ id: string, score: number, metadata?: any }> = []
    for (let i = 0; i < results.length; i += 2) {
      const id = results[i]
      const score = Number.parseInt(results[i + 1])

      // Fetch metadata for each entry at key:meta:id
      const metaKey = `${key}:meta:${id}`
      const rawMetadata = await this.redis.hgetall(metaKey)

      let metadata: any = undefined
      if (Object.keys(rawMetadata).length > 0) {
        // Use generic parser to deserialize all fields
        metadata = this.parseHashFields(rawMetadata)
      }

      entries.push({
        id,
        score,
        metadata,
      })
    }

    return entries
  }

  async indexUpdate(key: string, id: string, metadata: Record<string, any>): Promise<boolean> {
    if (!this.redis.status || this.redis.status === 'end') {
      await this.redis.connect()
    }

    const metaKey = `${key}:meta:${id}`

    // Get current version
    const current = await this.redis.hget(metaKey, 'version')
    const currentVersion = current ? Number.parseInt(current, 10) : 0

    // Optimistic lock: only update if version matches
    const script = `
      local current = redis.call('HGET', KEYS[1], 'version')
      if current == ARGV[1] then
        for i = 2, #ARGV, 2 do
          redis.call('HSET', KEYS[1], ARGV[i], ARGV[i + 1])
        end
        redis.call('HSET', KEYS[1], 'version', tonumber(ARGV[1]) + 1)
        return 1
      else
        return 0
      end
    `

    // Serialize metadata generically
    const serialized = this.serializeHashFields(metadata)

    // Build arguments: [version, key1, val1, key2, val2, ...]
    const args = [currentVersion.toString()]
    for (const [k, v] of Object.entries(serialized)) {
      args.push(k)
      args.push(v)
    }

    const result = await this.redis.eval(script, 1, metaKey, ...args) as number
    return result === 1
  }

  async indexUpdateWithRetry(
    key: string,
    id: string,
    metadata: Record<string, any>,
    maxRetries = 3,
  ): Promise<void> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const success = await this.indexUpdate(key, id, metadata)

      if (success) return

      // Version conflict - exponential backoff
      await new Promise(resolve => setTimeout(resolve, 10 * Math.pow(2, attempt)))
    }

    throw new Error(`Failed to update index after ${maxRetries} retries`)
  }

  async indexIncrement(key: string, id: string, field: string, increment = 1): Promise<number> {
    if (!this.redis.status || this.redis.status === 'end') {
      await this.redis.connect()
    }

    const metaKey = `${key}:meta:${id}`

    // Use Redis HINCRBY for atomic increment
    const newValue = await this.redis.hincrby(metaKey, field, increment)

    // Also increment version for consistency
    await this.redis.hincrby(metaKey, 'version', 1)

    return newValue
  }

  async indexDelete(key: string, id: string): Promise<boolean> {
    if (!this.redis.status || this.redis.status === 'end') {
      await this.redis.connect()
    }

    // Remove from sorted set
    const removed = await this.redis.zrem(key, id)

    // Delete metadata hash
    const metaKey = `${key}:meta:${id}`
    await this.redis.del(metaKey)

    return removed > 0
  }

  async delete(subject: string): Promise<boolean> {
    if (!this.redis.status || this.redis.status === 'end') {
      await this.redis.connect()
    }

    // Delete Redis stream (XDEL removes individual entries, but we want to delete the entire stream)
    // Use DEL to remove the entire stream key
    const deleted = await this.redis.del(subject)

    return deleted > 0
  }

  // ============================================================
  // Cleanup
  // ============================================================

  async close(): Promise<void> {
    try {
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
    const moduleOptions = (runtimeConfig as any).nventStoreRedis || {}
    const nventConfig = (runtimeConfig as any).nvent || {}

    // Get connection from module options, nvent config, or connections config
    const connection = moduleOptions.connection
      || nventConfig.store?.connection
      || nventConfig.connections?.redis

    if (!connection) {
      console.warn('[adapter-store-redis] No Redis connection config found')
    }

    const config = defu(moduleOptions, {
      connection,
      prefix: nventConfig.store?.prefix || 'nq',
      streams: {
        trim: {
          maxLen: 10000,
          approx: true,
        },
      },
    })

    // Create and register adapter
    const adapter = new RedisStoreAdapter({
      connection: config.connection,
      prefix: config.prefix,
      streams: config.streams,
    })

    registerStoreAdapter('redis', adapter)

    console.log('[adapter-store-redis] Redis store adapter registered')
  })
})
