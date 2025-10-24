export interface StateProvider {
  get<T = any>(key: string): Promise<T | null>
  set<T = any>(key: string, value: T, opts?: { ttl?: number }): Promise<void>
  delete(key: string): Promise<void>
  list(prefix: string, opts?: { limit?: number }): Promise<{ keys: string[] }>
  patch<T = any>(key: string, updater: (prev: T | null) => T, opts?: { retries?: number }): Promise<T>
}

// Minimal storage interface we rely on (compatible with unstorage)
export interface StorageLike {
  getItem<T = any>(key: string): Promise<T | null>
  setItem<T = any>(key: string, value: T, opts?: { ttl?: number }): Promise<void>
  removeItem(key: string): Promise<void>
  getKeys(base?: string): Promise<string[]>
}
