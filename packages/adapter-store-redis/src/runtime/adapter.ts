import type { StoreAdapter, EventRecord, EventReadOptions } from '#nvent/adapters'
import { useRuntimeConfig, registerStoreAdapter, defineNitroPlugin, createStoreValidator } from '#imports'
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
  private validator: ReturnType<typeof createStoreValidator>
  public kv: StoreAdapter['kv']
  public stream: StoreAdapter['stream']
  public index: StoreAdapter['index']

  constructor(private options: RedisStoreAdapterOptions) {
    const conn = options.connection

    console.log('[adapter-store-redis] Initializing with connection:', {
      host: conn?.host || 'localhost',
      port: conn?.port || 6379,
      hasPassword: !!conn?.password,
      db: conn?.db || 0,
    })

    this.redis = new IORedis({
      host: conn?.host || 'localhost',
      port: conn?.port || 6379,
      username: conn?.username,
      password: conn?.password,
      db: conn?.db || 0,
      lazyConnect: true,
      enableReadyCheck: false,
      retryStrategy: (times) => {
        if (times > 3) {
          console.error('[adapter-store-redis] Failed to connect after 3 attempts')
          return null // Stop retrying
        }
        console.log(`[adapter-store-redis] Retry attempt ${times}`)
        return Math.min(times * 100, 3000)
      },
    })

    // Handle connection errors
    this.redis.on('error', (err) => {
      console.error('[adapter-store-redis] Redis connection error:', err.message)
    })

    this.redis.on('connect', () => {
      console.log('[adapter-store-redis] Connected to Redis')
    })

    this.prefix = options.prefix || 'nvent'
    this.streamOptions = options.streams || {}
    this.validator = createStoreValidator('RedisStoreAdapter')

    // Initialize stream methods
    this.stream = {
      append: async (subject: string, event: Omit<EventRecord, 'id' | 'ts'>) => {
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
      },

      read: async (subject: string, opts?: EventReadOptions) => {
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
      },

      delete: async (subject: string) => {
        if (!this.redis.status || this.redis.status === 'end') {
          await this.redis.connect()
        }

        // Delete Redis stream (XDEL removes individual entries, but we want to delete the entire stream)
        // Use DEL to remove the entire stream key
        const deleted = await this.redis.del(subject)

        return deleted > 0
      },
    }

    // Initialize KV store methods
    // Note: Keys are used as-is without additional prefixing
    // Callers should include the full key path (e.g., 'nvent:scheduler:lock:xyz')
    this.kv = {
      get: async <T = any>(key: string): Promise<T | null> => {
        if (!this.redis.status || this.redis.status === 'end') {
          await this.redis.connect()
        }

        const data = await this.redis.get(key)
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

        const serialized = typeof value === 'string' ? value : JSON.stringify(value)

        if (ttl) {
          await this.redis.setex(key, ttl, serialized)
        }
        else {
          await this.redis.set(key, serialized)
        }
      },

      delete: async (key: string): Promise<void> => {
        if (!this.redis.status || this.redis.status === 'end') {
          await this.redis.connect()
        }

        await this.redis.del(key)
      },

      clear: async (pattern: string): Promise<number> => {
        if (!this.redis.status || this.redis.status === 'end') {
          await this.redis.connect()
        }

        let cursor = '0'
        const keysToDelete: string[] = []

        do {
          const result = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
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

        // Fallback to simple INCRBY for string keys
        return await this.redis.incrby(key, by)
      },
    }

    // Initialize index methods
    this.index = {
      add: async (key: string, id: string, score: number, metadata?: Record<string, any>) => {
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
          const { serialized } = this.serializeHashFields(metaToStore)
          await this.redis.hset(metaKey, serialized)
        }
      },

      get: async (key: string, id: string) => {
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
      },

      read: async (key: string, opts?: { offset?: number, limit?: number, filter?: Record<string, any> }) => {
        if (!this.redis.status || this.redis.status === 'end') {
          await this.redis.connect()
        }

        const offset = opts?.offset || 0
        const limit = opts?.limit || 50

        // Helper to check if entry matches filter
        const matchesFilter = (metadata: any, filter: Record<string, any>): boolean => {
          for (const [field, value] of Object.entries(filter)) {
            if (Array.isArray(value)) {
              if (!value.includes(metadata?.[field])) return false
            }
            else if (metadata?.[field] !== value) {
              return false
            }
          }
          return true
        }

        // If filter is provided, we need to scan more entries and filter
        // This is less efficient for Redis but necessary since we can't query hash fields
        if (opts?.filter && Object.keys(opts.filter).length > 0) {
          // Fetch more entries to account for filtering
          // We'll fetch in batches until we have enough matching entries
          const matchingEntries: Array<{ id: string, score: number, metadata?: any }> = []
          let scanOffset = 0
          const batchSize = 100
          const maxScanned = 10000 // Safety limit

          while (matchingEntries.length < offset + limit && scanOffset < maxScanned) {
            const end = scanOffset + batchSize - 1
            const results = await this.redis.zrevrange(key, scanOffset, end, 'WITHSCORES')

            if (results.length === 0) break // No more entries

            for (let i = 0; i < results.length; i += 2) {
              const id = results[i]
              const score = Number.parseInt(results[i + 1])

              // Fetch metadata
              const metaKey = `${key}:meta:${id}`
              const rawMetadata = await this.redis.hgetall(metaKey)

              let metadata: any = undefined
              if (Object.keys(rawMetadata).length > 0) {
                metadata = this.parseHashFields(rawMetadata)
              }

              // Check if matches filter
              if (matchesFilter(metadata, opts.filter!)) {
                matchingEntries.push({ id, score, metadata })
              }

              // Stop if we have enough
              if (matchingEntries.length >= offset + limit) break
            }

            scanOffset += batchSize
          }

          // Apply offset and limit to matching entries
          return matchingEntries.slice(offset, offset + limit)
        }

        // No filter - use efficient direct range query
        const end = offset + limit - 1
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
      },

      update: async (key: string, id: string, metadata: Record<string, any>) => {
        if (!this.redis.status || this.redis.status === 'end') {
          await this.redis.connect()
        }

        // Validate update payload
        this.validator.validateUpdatePayload(metadata, 'index.update')

        const metaKey = `${key}:meta:${id}`

        // Get current version
        const current = await this.redis.hget(metaKey, 'version')
        const currentVersion = current ? Number.parseInt(current, 10) : 0

        // Optimistic lock: only update if version matches
        // Script args: version, setCount, [set key/value pairs...], [delete keys...]
        const script = `
          local current = redis.call('HGET', KEYS[1], 'version')
          if current == ARGV[1] then
            local setCount = tonumber(ARGV[2])
            -- Process HSET operations (pairs starting at ARGV[3])
            for i = 1, setCount do
              local keyIdx = 3 + (i - 1) * 2
              local valIdx = keyIdx + 1
              redis.call('HSET', KEYS[1], ARGV[keyIdx], ARGV[valIdx])
            end
            -- Process HDEL operations (keys starting after set pairs)
            local deleteStart = 3 + setCount * 2
            for i = deleteStart, #ARGV do
              redis.call('HDEL', KEYS[1], ARGV[i])
            end
            redis.call('HSET', KEYS[1], 'version', tonumber(ARGV[1]) + 1)
            return 1
          else
            return 0
          end
        `

        // Serialize metadata generically (returns both values and null keys)
        const { serialized, nullKeys } = this.serializeHashFields(metadata)

        // Build arguments: [version, setCount, key1, val1, key2, val2, ..., delKey1, delKey2, ...]
        const setEntries = Object.entries(serialized)
        const args = [currentVersion.toString(), setEntries.length.toString()]
        for (const [k, v] of setEntries) {
          args.push(k)
          args.push(v)
        }
        // Add keys to delete
        for (const delKey of nullKeys) {
          args.push(delKey)
        }

        const result = await this.redis.eval(script, 1, metaKey, ...args) as number
        return result === 1
      },

      updateWithRetry: async (
        key: string,
        id: string,
        metadata: Record<string, any>,
        maxRetries = 3,
      ) => {
        // Validate once before retries
        this.validator.validateUpdatePayload(metadata, 'index.updateWithRetry')

        for (let attempt = 0; attempt < maxRetries; attempt++) {
          const success = await this.index.update(key, id, metadata)

          if (success) return

          // Version conflict - exponential backoff
          await new Promise(resolve => setTimeout(resolve, 10 * Math.pow(2, attempt)))
        }

        throw new Error(`Failed to update index after ${maxRetries} retries`)
      },

      increment: async (key: string, id: string, field: string, increment = 1) => {
        if (!this.redis.status || this.redis.status === 'end') {
          await this.redis.connect()
        }

        const metaKey = `${key}:meta:${id}`

        // Use Redis HINCRBY for atomic increment
        const newValue = await this.redis.hincrby(metaKey, field, increment)

        // Also increment version for consistency
        await this.redis.hincrby(metaKey, 'version', 1)

        return newValue
      },

      delete: async (key: string, id: string) => {
        if (!this.redis.status || this.redis.status === 'end') {
          await this.redis.connect()
        }

        // Remove from sorted set
        const removed = await this.redis.zrem(key, id)

        // Delete metadata hash
        const metaKey = `${key}:meta:${id}`
        await this.redis.del(metaKey)

        return removed > 0
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
   * - Handles boolean strings ('true'/'false')
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

      // Handle boolean strings
      if (v === 'true') {
        flat[k] = true
        continue
      }
      if (v === 'false') {
        flat[k] = false
        continue
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
   * Also handles already-nested objects by recursively processing them
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

        // If value is an object, recursively expand it
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          current[keys[keys.length - 1]] = this.expandDotNotation(value)
        }
        else {
          current[keys[keys.length - 1]] = value
        }
      }
      else {
        // If value is an object, recursively expand it
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          result[key] = this.expandDotNotation(value)
        }
        else {
          result[key] = value
        }
      }
    }

    return result
  }

  /**
   * Flatten nested objects to dot notation for Redis hash storage
   * e.g., { stats: { totalFires: 5 } } -> { 'stats.totalFires': 5 }
   * Returns both values and null keys (for deletion)
   */
  private flattenToHashFields(obj: Record<string, any>, prefix = ''): { values: Record<string, any>, nullKeys: string[] } {
    const values: Record<string, any> = {}
    const nullKeys: string[] = []

    for (const [key, value] of Object.entries(obj)) {
      const newKey = prefix ? `${prefix}.${key}` : key

      if (value === null) {
        // Track null values as keys to delete
        nullKeys.push(newKey)
      }
      else if (typeof value === 'object' && !Array.isArray(value)) {
        // Recursively flatten nested objects
        const nested = this.flattenToHashFields(value, newKey)
        Object.assign(values, nested.values)
        nullKeys.push(...nested.nullKeys)
      }
      else {
        values[newKey] = value
      }
    }

    return { values, nullKeys }
  }

  /**
   * Serialize values for Redis hash storage
   * - Nested objects → Flattened with dot notation
   * - Arrays → JSON
   * - Others → String
   * Returns both serialized values and keys to delete (null values)
   */
  private serializeHashFields(obj: Record<string, any>): { serialized: Record<string, string>, nullKeys: string[] } {
    // First expand any dot notation, then flatten to ensure consistency
    const expanded = this.expandDotNotation(obj)
    const { values: flattened, nullKeys } = this.flattenToHashFields(expanded)

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

    return { serialized, nullKeys }
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
      prefix: nventConfig.store?.prefix || 'nvent',
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
