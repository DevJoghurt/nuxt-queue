/**
 * Adapter Registry
 *
 * Central registry for all adapter types (queue, stream, store)
 * Adapters are registered via the nvent:registerAdapter Nuxt hook
 */

import type { QueueAdapter, StreamAdapter, StoreAdapter } from './interfaces'

export class AdapterRegistry {
  private queueAdapters = new Map<string, QueueAdapter>()
  private streamAdapters = new Map<string, StreamAdapter>()
  private storeAdapters = new Map<string, StoreAdapter>()

  // ============================================================
  // Registration
  // ============================================================

  /**
   * Register a queue adapter
   * @param name - Adapter name (e.g., 'redis', 'memory', 'postgres')
   * @param adapter - QueueAdapter implementation
   */
  registerQueue(name: string, adapter: QueueAdapter): void {
    if (this.queueAdapters.has(name)) {
      console.warn(`[nvent] Queue adapter "${name}" is already registered, overwriting`)
    }
    this.queueAdapters.set(name, adapter)
  }

  /**
   * Register a stream adapter
   * @param name - Adapter name (e.g., 'redis', 'memory', 'rabbitmq')
   * @param adapter - StreamAdapter implementation
   */
  registerStream(name: string, adapter: StreamAdapter): void {
    if (this.streamAdapters.has(name)) {
      console.warn(`[nvent] Stream adapter "${name}" is already registered, overwriting`)
    }
    this.streamAdapters.set(name, adapter)
  }

  /**
   * Register a store adapter
   * @param name - Adapter name (e.g., 'redis', 'memory', 'postgres')
   * @param adapter - StoreAdapter implementation
   */
  registerStore(name: string, adapter: StoreAdapter): void {
    if (this.storeAdapters.has(name)) {
      console.warn(`[nvent] Store adapter "${name}" is already registered, overwriting`)
    }
    this.storeAdapters.set(name, adapter)
  }

  // ============================================================
  // Retrieval
  // ============================================================

  /**
   * Get a queue adapter by name
   * @throws Error if adapter not found
   */
  getQueue(name: string): QueueAdapter {
    const adapter = this.queueAdapters.get(name)
    if (!adapter) {
      throw new Error(
        `[nvent] Queue adapter "${name}" not found. Available: ${Array.from(this.queueAdapters.keys()).join(', ')}`,
      )
    }
    return adapter
  }

  /**
   * Get a stream adapter by name
   * @throws Error if adapter not found
   */
  getStream(name: string): StreamAdapter {
    const adapter = this.streamAdapters.get(name)
    if (!adapter) {
      throw new Error(
        `[nvent] Stream adapter "${name}" not found. Available: ${Array.from(this.streamAdapters.keys()).join(', ')}`,
      )
    }
    return adapter
  }

  /**
   * Get a store adapter by name
   * @throws Error if adapter not found
   */
  getStore(name: string): StoreAdapter {
    const adapter = this.storeAdapters.get(name)
    if (!adapter) {
      throw new Error(
        `[nvent] Store adapter "${name}" not found. Available: ${Array.from(this.storeAdapters.keys()).join(', ')}`,
      )
    }
    return adapter
  }

  // ============================================================
  // Utilities
  // ============================================================

  /**
   * Check if a queue adapter is registered
   */
  hasQueue(name: string): boolean {
    return this.queueAdapters.has(name)
  }

  /**
   * Check if a stream adapter is registered
   */
  hasStream(name: string): boolean {
    return this.streamAdapters.has(name)
  }

  /**
   * Check if a store adapter is registered
   */
  hasStore(name: string): boolean {
    return this.storeAdapters.has(name)
  }

  /**
   * List all registered queue adapters
   */
  listQueueAdapters(): string[] {
    return Array.from(this.queueAdapters.keys())
  }

  /**
   * List all registered stream adapters
   */
  listStreamAdapters(): string[] {
    return Array.from(this.streamAdapters.keys())
  }

  /**
   * List all registered store adapters
   */
  listStoreAdapters(): string[] {
    return Array.from(this.storeAdapters.keys())
  }

  /**
   * Initialize all registered adapters
   */
  async initAll(): Promise<void> {
    const promises: Promise<void>[] = []

    // Initialize all queue adapters
    Array.from(this.queueAdapters.values()).forEach((adapter) => {
      promises.push(adapter.init())
    })

    // Initialize all stream adapters
    Array.from(this.streamAdapters.values()).forEach((adapter) => {
      promises.push(adapter.init())
    })

    // Note: StoreAdapter doesn't have init() method, only close()

    await Promise.all(promises)
  }

  /**
   * Close/cleanup all registered adapters
   */
  async closeAll(): Promise<void> {
    const promises: Promise<void>[] = []

    // Close all queue adapters
    Array.from(this.queueAdapters.values()).forEach((adapter) => {
      promises.push(adapter.close())
    })

    // Shutdown all stream adapters
    Array.from(this.streamAdapters.values()).forEach((adapter) => {
      promises.push(adapter.shutdown())
    })

    // Close all store adapters
    Array.from(this.storeAdapters.values()).forEach((adapter) => {
      promises.push(adapter.close())
    })

    await Promise.all(promises)
  }
}

// Singleton instance
let registry: AdapterRegistry | null = null

/**
 * Get the global adapter registry instance
 */
export function useAdapterRegistry(): AdapterRegistry {
  if (!registry) {
    registry = new AdapterRegistry()
  }
  return registry
}

/**
 * Reset the registry (useful for testing)
 */
export function resetAdapterRegistry(): void {
  registry = null
}
