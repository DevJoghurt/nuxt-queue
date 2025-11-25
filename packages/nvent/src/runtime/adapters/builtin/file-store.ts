/**
 * File Store Adapter
 *
 * File-based storage for development/small deployments
 * - Extends MemoryStoreAdapter with persistence
 * - Fast in-memory access backed by file system
 * - Survives restarts
 * - Single instance only
 *
 * Storage format:
 * - {dataDir}/streams/{subject}.ndjson - Event streams (append-only NDJSON)
 * - {dataDir}/indices/{key}.json - Sorted indices (JSON arrays)
 * - {dataDir}/kv/{key}.json - KV store (individual JSON files)
 */

import { promises as fs } from 'node:fs'
import { join, dirname } from 'node:path'
import { MemoryStoreAdapter } from './memory-store'

export interface FileStoreAdapterOptions {
  dataDir: string
}

function sanitize(name: string) {
  return name.replace(/[^\w.-]/g, '_')
}

async function ensureDir(path: string) {
  try {
    await fs.mkdir(path, { recursive: true })
  }
  catch { /* ignore */ }
}

/**
 * File-backed store adapter
 * Extends memory store and persists on every write using same format as existing file adapter
 */
export class FileStoreAdapter extends MemoryStoreAdapter {
  private options: FileStoreAdapterOptions
  private parentKvGet: (key: string) => Promise<any>
  private parentKvSet: (key: string, value: any, ttl?: number) => Promise<void>
  private parentKvDelete: (key: string) => Promise<void>
  private parentKvClear: (pattern: string) => Promise<number>
  private parentKvIncrement: (key: string, by?: number) => Promise<number>

  constructor(options: FileStoreAdapterOptions) {
    super()
    this.options = options

    // CRITICAL: Save references to parent methods BEFORE overriding kv
    // Must save each method separately to break circular reference
    const tempKv = this.kv
    this.parentKvGet = tempKv.get
    this.parentKvSet = tempKv.set
    this.parentKvDelete = tempKv.delete
    this.parentKvClear = tempKv.clear!
    this.parentKvIncrement = tempKv.increment!

    // Now override kv with persistence wrapper IN CONSTRUCTOR
    // This must happen here, not as a class field, to ensure parent methods are saved first
    this.kv = {
      get: async (key: string) => {
        return this.parentKvGet(key)
      },

      set: async <T = any>(key: string, value: T, ttl?: number) => {
        await this.parentKvSet(key, value, ttl)

        // Persist to individual JSON file
        const path = this.kvPath(key)
        await ensureDir(dirname(path))
        await fs.writeFile(path, JSON.stringify(value), 'utf-8')
      },

      delete: async (key: string) => {
        await this.parentKvDelete(key)

        // Delete KV file
        const path = this.kvPath(key)
        try {
          await fs.unlink(path)
        }
        catch {
          // File might not exist
        }
      },

      clear: async (pattern: string) => {
        const count = await this.parentKvClear(pattern)

        // Delete matching KV files
        try {
          const kvDir = join(this.options.dataDir, 'kv')
          const files = await fs.readdir(kvDir)
          const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`)

          for (const file of files) {
            if (!file.endsWith('.json')) continue
            const key = file.replace('.json', '').replace(/_/g, ':')
            if (regex.test(key)) {
              await fs.unlink(join(kvDir, file))
            }
          }
        }
        catch {
          // Directory might not exist
        }

        return count
      },

      increment: async (key: string, by: number = 1) => {
        const result = await this.parentKvIncrement(key, by)

        // Persist updated value
        const path = this.kvPath(key)
        await ensureDir(dirname(path))
        await fs.writeFile(path, JSON.stringify(result), 'utf-8')

        return result
      },
    }
  }

  private streamPath(subject: string) {
    return join(this.options.dataDir, 'streams', sanitize(subject) + '.ndjson')
  }

  private indexPath(key: string) {
    return join(this.options.dataDir, 'indices', sanitize(key) + '.json')
  }

  private kvPath(key: string) {
    return join(this.options.dataDir, 'kv', `${sanitize(key)}.json`)
  }

  async init(): Promise<void> {
    // Create directory structure
    await ensureDir(this.options.dataDir)
    await ensureDir(join(this.options.dataDir, 'streams'))
    await ensureDir(join(this.options.dataDir, 'indices'))
    await ensureDir(join(this.options.dataDir, 'kv'))

    // Load existing data from disk
    await this.loadFromDisk()
  }

  private async loadFromDisk(): Promise<void> {
    const self = this as any

    // Load event streams from NDJSON files in streams directory
    try {
      const streamsDir = join(this.options.dataDir, 'streams')
      const files = await fs.readdir(streamsDir)
      for (const file of files) {
        if (!file.endsWith('.ndjson')) continue

        const subject = file.replace('.ndjson', '').replace(/_/g, ':') // Unsanitize
        const content = await fs.readFile(join(streamsDir, file), 'utf-8')
        const lines = content.trim().split('\n').filter(l => l.length > 0)
        const events = lines.map(line => JSON.parse(line))

        if (!self.eventStreams) self.eventStreams = new Map()
        self.eventStreams.set(subject, events)
      }
    }
    catch {
      // Directory doesn't exist yet or no streams
    }

    // Load indices from indices/ subdirectory
    try {
      const indicesDir = join(this.options.dataDir, 'indices')
      const indexFiles = await fs.readdir(indicesDir)

      for (const file of indexFiles) {
        if (!file.endsWith('.json')) continue

        const key = file.replace('.json', '').replace(/_/g, ':') // Unsanitize
        const content = await fs.readFile(join(indicesDir, file), 'utf-8')
        const entries = JSON.parse(content)

        if (!self.sortedIndices) self.sortedIndices = new Map()
        self.sortedIndices.set(key, entries)
      }
    }
    catch {
      // No indices yet
    }

    // Load KV store from kv/ subdirectory
    try {
      const kvDir = join(this.options.dataDir, 'kv')
      const kvFiles = await fs.readdir(kvDir)

      for (const file of kvFiles) {
        if (!file.endsWith('.json')) continue

        const key = file.replace('.json', '').replace(/_/g, ':') // Unsanitize
        const content = await fs.readFile(join(kvDir, file), 'utf-8')
        const value = JSON.parse(content)

        if (!self.kvStore) self.kvStore = new Map()
        self.kvStore.set(key, value)
      }
    }
    catch {
      // No KV data yet
    }
  }

  // Override methods to add persistence

  async append(subject: string, event: Omit<import('../interfaces/store').EventRecord, 'id' | 'ts'>) {
    const result = await super.append(subject, event)

    // Append to NDJSON file (like existing file adapter)
    const path = this.streamPath(subject)
    await ensureDir(dirname(path))
    await fs.appendFile(path, JSON.stringify(result) + '\n', 'utf-8')

    return result
  }

  // Override index operations

  async indexAdd(key: string, id: string, score: number, metadata?: Record<string, any>) {
    await super.indexAdd!(key, id, score, metadata)

    // Persist index to JSON file (like existing file adapter)
    const self = this as any
    const index = self.sortedIndices?.get(key)
    if (index) {
      const path = this.indexPath(key)
      await ensureDir(dirname(path))
      await fs.writeFile(path, JSON.stringify(index, null, 2), 'utf-8')
    }
  }

  async indexUpdate(key: string, id: string, metadata: Record<string, any>) {
    // Call parent which handles locking internally
    const result = await super.indexUpdate!(key, id, metadata)

    // Persist updated index
    const self = this as any
    const index = self.sortedIndices?.get(key)
    if (index) {
      const path = this.indexPath(key)
      await ensureDir(dirname(path))
      await fs.writeFile(path, JSON.stringify(index, null, 2), 'utf-8')
    }

    return result
  }

  async indexUpdateWithRetry(
    key: string,
    id: string,
    metadata: Record<string, any>,
    maxRetries?: number,
  ) {
    await super.indexUpdateWithRetry!(key, id, metadata, maxRetries)

    // Persist updated index
    const self = this as any
    const index = self.sortedIndices?.get(key)
    if (index) {
      const path = this.indexPath(key)
      await ensureDir(dirname(path))
      await fs.writeFile(path, JSON.stringify(index, null, 2), 'utf-8')
    }
  }

  async indexIncrement(key: string, id: string, field: string, increment?: number) {
    // Call parent which handles locking internally
    const result = await super.indexIncrement!(key, id, field, increment)

    // Persist updated index
    const self = this as any
    const index = self.sortedIndices?.get(key)
    if (index) {
      const path = this.indexPath(key)
      await ensureDir(dirname(path))
      await fs.writeFile(path, JSON.stringify(index, null, 2), 'utf-8')
    }

    return result
  }

  async indexDelete(key: string, id: string): Promise<boolean> {
    // Remove from memory
    const self = this as any
    const index = self.sortedIndices?.get(key)
    if (!index) return false

    const initialLength = index.length
    const filtered = index.filter((entry: any) => entry.id !== id)

    if (filtered.length === initialLength) {
      return false // Entry not found
    }

    self.sortedIndices.set(key, filtered)

    // Persist updated index
    const path = this.indexPath(key)
    await ensureDir(dirname(path))
    await fs.writeFile(path, JSON.stringify(filtered, null, 2), 'utf-8')

    return true
  }

  async delete(subject: string): Promise<boolean> {
    // Remove from memory
    const self = this as any
    const eventStreams = self.eventStreams as Map<string, any[]>
    if (!eventStreams || !eventStreams.has(subject)) {
      return false
    }

    eventStreams.delete(subject)

    // Delete stream file
    const path = this.streamPath(subject)
    try {
      await fs.unlink(path)
      return true
    }
    catch {
      // File might not exist
      return false
    }
  }

  async close() {
    // All data is already persisted on write, no final snapshot needed
    await super.close()
  }
}
