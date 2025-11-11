<<<<<<< HEAD
/**
 * State provider interface - now backed by StoreAdapter KV
 * Provides scoped key-value storage for flow state
 */
=======
>>>>>>> 227da8b (refactoring)
export interface StateProvider {
  get<T = any>(key: string): Promise<T | null>
  set<T = any>(key: string, value: T, opts?: { ttl?: number }): Promise<void>
  delete(key: string): Promise<void>
<<<<<<< HEAD
  clear(pattern: string): Promise<number>
  increment?(key: string, by?: number): Promise<number>
=======
  list(prefix: string, opts?: { limit?: number }): Promise<{ keys: string[] }>
  patch<T = any>(key: string, updater: (prev: T | null) => T, opts?: { retries?: number }): Promise<T>
}

// Minimal storage interface we rely on (compatible with unstorage)
export interface StorageLike {
  getItem<T = any>(key: string): Promise<T | null>
  setItem<T = any>(key: string, value: T, opts?: { ttl?: number }): Promise<void>
  removeItem(key: string): Promise<void>
  getKeys(base?: string): Promise<string[]>
>>>>>>> 227da8b (refactoring)
}
