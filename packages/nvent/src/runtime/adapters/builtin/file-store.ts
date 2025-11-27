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

  constructor(options: FileStoreAdapterOptions) {
    super()
    this.options = options

    // Save references to parent methods to wrap them with persistence
    const parentKv = this.kv
    const parentStream = this.stream
    const parentIndex = this.index

    // Override kv methods with persistence wrappers
    this.kv = {
      get: parentKv.get,

      set: async <T = any>(key: string, value: T, ttl?: number) => {
        await parentKv.set(key, value, ttl)

        // Persist to individual JSON file
        const path = this.kvPath(key)
        await ensureDir(dirname(path))
        await fs.writeFile(path, JSON.stringify(value), 'utf-8')
      },

      delete: async (key: string) => {
        await parentKv.delete(key)

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
        const count = await parentKv.clear!(pattern)

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
        const result = await parentKv.increment!(key, by)

        // Persist updated value
        const path = this.kvPath(key)
        await ensureDir(dirname(path))
        await fs.writeFile(path, JSON.stringify(result), 'utf-8')

        return result
      },
    }

    // Override stream methods with persistence
    this.stream = {
      append: async (subject: string, event: Omit<import('../interfaces/store').EventRecord, 'id' | 'ts'>) => {
        const result = await parentStream.append(subject, event)

        // Append to NDJSON file
        const path = this.streamPath(subject)
        await ensureDir(dirname(path))
        await fs.appendFile(path, JSON.stringify(result) + '\n', 'utf-8')

        return result
      },

      read: parentStream.read,
      subscribe: parentStream.subscribe,

      delete: async (subject: string) => {
        // Use parent's delete if available
        const deleted = parentStream.delete ? await parentStream.delete(subject) : false

        if (deleted) {
          // Delete stream file
          const path = this.streamPath(subject)
          try {
            await fs.unlink(path)
          }
          catch {
            // File might not exist
          }
        }

        return deleted
      },
    }

    // Override index methods with persistence
    this.index = {
      add: async (key: string, id: string, score: number, metadata?: Record<string, any>) => {
        await parentIndex.add(key, id, score, metadata)

        // Persist index to JSON file
        const self = this as any
        const index = self.sortedIndices?.get(key)
        if (index) {
          const path = this.indexPath(key)
          await ensureDir(dirname(path))
          await fs.writeFile(path, JSON.stringify(index, null, 2), 'utf-8')
        }
      },

      get: parentIndex.get,
      read: parentIndex.read,

      update: async (key: string, id: string, metadata: Record<string, any>) => {
        const result = await parentIndex.update(key, id, metadata)

        // Persist updated index
        const self = this as any
        const index = self.sortedIndices?.get(key)
        if (index) {
          const path = this.indexPath(key)
          await ensureDir(dirname(path))
          await fs.writeFile(path, JSON.stringify(index, null, 2), 'utf-8')
        }

        return result
      },

      updateWithRetry: async (
        key: string,
        id: string,
        metadata: Record<string, any>,
        maxRetries?: number,
      ) => {
        await parentIndex.updateWithRetry(key, id, metadata, maxRetries)

        // Persist updated index
        const self = this as any
        const index = self.sortedIndices?.get(key)
        if (index) {
          const path = this.indexPath(key)
          await ensureDir(dirname(path))
          await fs.writeFile(path, JSON.stringify(index, null, 2), 'utf-8')
        }
      },

      increment: async (key: string, id: string, field: string, increment?: number) => {
        const result = await parentIndex.increment(key, id, field, increment)

        // Persist updated index
        const self = this as any
        const index = self.sortedIndices?.get(key)
        if (index) {
          const path = this.indexPath(key)
          await ensureDir(dirname(path))
          await fs.writeFile(path, JSON.stringify(index, null, 2), 'utf-8')
        }

        return result
      },

      delete: async (key: string, id: string): Promise<boolean> => {
        const deleted = await parentIndex.delete(key, id)

        if (deleted) {
          // Persist updated index
          const self = this as any
          const index = self.sortedIndices?.get(key)
          if (index) {
            const path = this.indexPath(key)
            await ensureDir(dirname(path))
            await fs.writeFile(path, JSON.stringify(index, null, 2), 'utf-8')
          }
        }

        return deleted
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

  async close() {
    // All data is already persisted on write, no final snapshot needed
    await super.close()
  }
}
