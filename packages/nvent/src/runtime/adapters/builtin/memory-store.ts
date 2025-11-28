/**
 * Memory Store Adapter
 *
 * In-memory storage implementation for development
 * Three-tier storage:
 * 1. Event Stream - Append-only event log
 * 2. Sorted Index - Time-ordered metadata storage
 * 3. Key-Value Store - Fast lookups
 *
 * All data is lost on restart (ephemeral)
 */

import { defu } from 'defu'
import { createStoreValidator } from '../base/store-validator'
import type {
  StoreAdapter,
  EventRecord,
  EventReadOptions,
  EventSubscription,
} from '../interfaces/store'

export class MemoryStoreAdapter implements StoreAdapter {
  // Event Stream storage: subject -> events
  private eventStreams = new Map<string, EventRecord[]>()
  private eventSubscriptions = new Map<string, Map<string, (event: EventRecord) => void>>()
  private subscriptionCounter = 0

  // Key-Value Store storage: key -> value
  private kvStore = new Map<string, any>()

  // Sorted index storage: key -> sorted array of {id, score, metadata}
  private sortedIndices = new Map<string, Array<{ id: string, score: number, metadata?: any }>>()

  // Validator for update operations
  protected validator = createStoreValidator('MemoryStoreAdapter')

  // Lock mechanism for atomic index operations
  private indexLocks = new Map<string, Promise<void>>()

  async close(): Promise<void> {
    this.eventStreams.clear()
    this.eventSubscriptions.clear()
    this.kvStore.clear()
    this.sortedIndices.clear()
  }

  // ============================================================
  // Event Stream
  // ============================================================

  stream = {
    append: async (subject: string, event: Omit<EventRecord, 'id' | 'ts'>): Promise<EventRecord> => {
      // Generate ID and timestamp
      const eventRecord: EventRecord = {
        id: this.generateId(),
        ts: Date.now(),
        ...event,
      }

      // Get or create event stream for subject
      if (!this.eventStreams.has(subject)) {
        this.eventStreams.set(subject, [])
      }

      const stream = this.eventStreams.get(subject)!
      stream.push(eventRecord)

      // Notify in-process subscribers
      this.notifySubscribers(subject, eventRecord)

      return eventRecord
    },

    read: async (subject: string, opts?: EventReadOptions): Promise<EventRecord[]> => {
      const stream = this.eventStreams.get(subject) || []

      let events = [...stream]

      // Filter by event types
      if (opts?.types && opts.types.length > 0) {
        events = events.filter(e => opts.types!.includes(e.type))
      }

      // Filter by ID range
      if (opts?.after) {
        const afterIndex = events.findIndex(e => e.id === opts.after)
        if (afterIndex >= 0) {
          events = events.slice(afterIndex + 1)
        }
      }

      if (opts?.before) {
        const beforeIndex = events.findIndex(e => e.id === opts.before)
        if (beforeIndex >= 0) {
          events = events.slice(0, beforeIndex)
        }
      }

      // Filter by timestamp range
      if (opts?.from) {
        events = events.filter(e => e.ts >= opts.from!)
      }

      if (opts?.to) {
        events = events.filter(e => e.ts <= opts.to!)
      }

      // Apply sort order
      if (opts?.order === 'desc') {
        events.reverse()
      }

      // Apply limit
      if (opts?.limit) {
        events = events.slice(0, opts.limit)
      }

      return events
    },

    subscribe: async (subject: string, onEvent: (event: EventRecord) => void): Promise<EventSubscription> => {
      const subscriptionId = `sub-${++this.subscriptionCounter}`

      // Get or create subscriptions for subject
      if (!this.eventSubscriptions.has(subject)) {
        this.eventSubscriptions.set(subject, new Map())
      }

      const subjectSubs = this.eventSubscriptions.get(subject)!
      subjectSubs.set(subscriptionId, onEvent)

      return {
        id: subscriptionId,
        subject,
        unsubscribe: async () => {
          const subs = this.eventSubscriptions.get(subject)
          if (subs) {
            subs.delete(subscriptionId)
            if (subs.size === 0) {
              this.eventSubscriptions.delete(subject)
            }
          }
        },
      }
    },

    delete: async (subject: string): Promise<boolean> => {
      const existed = this.eventStreams.has(subject)
      if (existed) {
        this.eventStreams.delete(subject)
        // Also clean up any subscriptions for this stream
        this.eventSubscriptions.delete(subject)
      }
      return existed
    },
  }

  private notifySubscribers(subject: string, event: EventRecord): void {
    const subs = this.eventSubscriptions.get(subject)
    if (subs) {
      Array.from(subs.values()).forEach((callback) => {
        try {
          callback(event)
        }
        catch (error) {
          console.error(`[MemoryStoreAdapter] Error in event subscription for ${subject}:`, error)
        }
      })
    }
  }

  // ============================================================
  // Key-Value Store
  // ============================================================

  kv = {
    get: async <T = any>(key: string): Promise<T | null> => {
      return this.kvStore.get(key) || null
    },

    set: async <T = any>(key: string, value: T, _ttl?: number): Promise<void> => {
      // TTL not supported in memory adapter (would need setTimeout)
      this.kvStore.set(key, value)
    },

    delete: async (key: string): Promise<void> => {
      this.kvStore.delete(key)
    },

    clear: async (pattern: string): Promise<number> => {
      // Simple glob pattern matching (* wildcard)
      const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`)
      const keys = Array.from(this.kvStore.keys())

      let count = 0
      for (const key of keys) {
        if (regex.test(key)) {
          this.kvStore.delete(key)
          count++
        }
      }

      return count
    },

    increment: async (key: string, by: number = 1): Promise<number> => {
      const current = this.kvStore.get(key) || 0
      const newValue = (typeof current === 'number' ? current : 0) + by
      this.kvStore.set(key, newValue)
      return newValue
    },
  }

  // ============================================================
  // Sorted Index (for time-ordered listings)
  // ============================================================

  index = {
    add: async (key: string, id: string, score: number, metadata?: Record<string, any>): Promise<void> => {
      // Get or create sorted index
      if (!this.sortedIndices.has(key)) {
        this.sortedIndices.set(key, [])
      }

      const index = this.sortedIndices.get(key)!

      // Check if entry already exists
      const existingIndex = index.findIndex(entry => entry.id === id)

      // Expand dot notation in metadata to ensure consistent nested structure
      const expandedMetadata = metadata ? this.expandDotNotation(metadata) : undefined

      const entry = {
        id,
        score,
        metadata: expandedMetadata ? { version: 0, ...expandedMetadata } : undefined,
      }

      if (existingIndex >= 0) {
        // Update existing entry
        index[existingIndex] = entry
      }
      else {
        // Add new entry
        index.push(entry)
      }

      // Keep sorted by score (descending for ZREVRANGE-like behavior)
      index.sort((a, b) => b.score - a.score)
    },

    get: async (key: string, id: string): Promise<{ id: string, score: number, metadata?: any } | null> => {
      const index = this.sortedIndices.get(key)
      if (!index) return null

      const entry = index.find(e => e.id === id)
      return entry ? { ...entry } : null
    },

    read: async (key: string, opts?: { offset?: number, limit?: number }): Promise<Array<{ id: string, score: number, metadata?: any }>> => {
      const index = this.sortedIndices.get(key) || []

      const offset = opts?.offset || 0
      const limit = opts?.limit || 50

      return index.slice(offset, offset + limit).map(e => ({ ...e }))
    },

    update: async (key: string, id: string, metadata: Record<string, any>): Promise<boolean> => {
      // Validate update payload
      this.validator.validateUpdatePayload(metadata, 'index.update')

      // Acquire lock for this index key to prevent concurrent modifications
      const lockKey = `${key}:${id}`
      const release = await this.acquireIndexLock(lockKey)

      try {
        const index = this.sortedIndices.get(key)
        if (!index) return false

        const entry = index.find(e => e.id === id)
        if (!entry || !entry.metadata) return false

        // Check version for optimistic locking
        const currentVersion = entry.metadata.version || 0

        // Convert dot notation to nested objects
        const updates = this.expandDotNotation(metadata)

        // Extract delete markers before merge
        const deleteMarkers = (updates as any).__deleteMarkers
        delete (updates as any).__deleteMarkers

        // Deep merge updates with existing metadata using defu
        // defu merges right to left, so we want: defu(updates, existing)
        entry.metadata = defu(updates, entry.metadata)

        // Handle deletions after merge
        if (deleteMarkers) {
          for (const { path } of deleteMarkers) {
            let current = entry.metadata
            for (let i = 0; i < path.length - 1; i++) {
              if (!current[path[i]]) break
              current = current[path[i]]
            }
            if (current) {
              const lastKey = path[path.length - 1]
              // Use Reflect.deleteProperty to avoid eslint error
              Reflect.deleteProperty(current, lastKey)
            }
          }
        }

        entry.metadata.version = currentVersion + 1

        return true
      }
      finally {
        // Always release the lock
        release()
      }
    },

    updateWithRetry: async (
      key: string,
      id: string,
      metadata: Record<string, any>,
      maxRetries: number = 3,
    ): Promise<void> => {
      // Validate once before retries
      this.validator.validateUpdatePayload(metadata, 'index.updateWithRetry')

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const success = await this.index.update(key, id, metadata)
        if (success) return

        // Small delay for retry (shouldn't happen in memory, but for consistency)
        await new Promise(resolve => setTimeout(resolve, 10 * Math.pow(2, attempt)))
      }

      throw new Error(`Failed to update index after ${maxRetries} retries`)
    },

    increment: async (key: string, id: string, field: string, increment: number = 1): Promise<number> => {
      // Acquire lock for this index key to prevent concurrent modifications
      const lockKey = `${key}:${id}`
      const release = await this.acquireIndexLock(lockKey)

      try {
        const index = this.sortedIndices.get(key)
        if (!index) throw new Error(`Index not found: ${key}`)

        const entry = index.find(e => e.id === id)
        if (!entry) throw new Error(`Entry not found: ${id} in index ${key}`)

        if (!entry.metadata) {
          entry.metadata = { version: 0 }
        }

        // Handle dot notation (e.g., 'stats.totalFires')
        let currentValue: number
        let newValue: number

        if (field.includes('.')) {
          const keys = field.split('.')
          let current = entry.metadata

          // Navigate to parent object
          for (let i = 0; i < keys.length - 1; i++) {
            const k = keys[i]
            if (!current[k] || typeof current[k] !== 'object') {
              current[k] = {}
            }
            current = current[k]
          }

          const lastKey = keys[keys.length - 1]
          currentValue = current[lastKey] || 0
          newValue = (typeof currentValue === 'number' ? currentValue : 0) + increment
          current[lastKey] = newValue
        }
        else {
          currentValue = entry.metadata[field] || 0
          newValue = (typeof currentValue === 'number' ? currentValue : 0) + increment
          entry.metadata[field] = newValue
        }

        entry.metadata.version = (entry.metadata.version || 0) + 1

        return newValue
      }
      finally {
        // Always release the lock
        release()
      }
    },

    delete: async (key: string, id: string): Promise<boolean> => {
      const index = this.sortedIndices.get(key)
      if (!index) return false

      const initialLength = index.length
      const filtered = index.filter(e => e.id !== id)

      if (filtered.length === initialLength) {
        return false // Entry not found
      }

      this.sortedIndices.set(key, filtered)
      return true
    },
  }

  /**
   * Acquire a lock for atomic index operations
   * Protected to allow access from FileStoreAdapter
   */
  protected async acquireIndexLock(key: string): Promise<() => void> {
    // Wait for any existing lock on this key
    while (this.indexLocks.has(key)) {
      await this.indexLocks.get(key)
    }

    // Create a new lock
    let releaseLock!: () => void
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve
    })
    this.indexLocks.set(key, lockPromise)

    // Return release function
    return () => {
      this.indexLocks.delete(key)
      releaseLock()
    }
  }

  /**
   * Convert dot notation keys to nested objects
   * e.g., { 'stats.totalFires': 5 } -> { stats: { totalFires: 5 } }
   * null values are preserved for deletion
   */
  private expandDotNotation(obj: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {}
    const deleteMarkers: Array<{ path: string[], delete: boolean }> = []

    for (const [key, value] of Object.entries(obj)) {
      if (key === 'version') {
        // Skip version, it's handled separately
        continue
      }

      if (key.includes('.')) {
        // Split by dot and create nested structure
        const keys = key.split('.')

        // Track null values for deletion after merge
        if (value === null || value === undefined) {
          deleteMarkers.push({ path: keys, delete: true })
          continue
        }

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

    // Store delete markers for post-merge processing
    if (deleteMarkers.length > 0) {
      (result as any).__deleteMarkers = deleteMarkers
    }

    return result
  }

  // ============================================================
  // Helpers
  // ============================================================

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }
}
