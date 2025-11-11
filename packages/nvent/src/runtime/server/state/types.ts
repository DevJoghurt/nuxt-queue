/**
 * State provider interface - now backed by StoreAdapter KV
 * Provides scoped key-value storage for flow state
 */
export interface StateProvider {
  get<T = any>(key: string): Promise<T | null>
  set<T = any>(key: string, value: T, opts?: { ttl?: number }): Promise<void>
  delete(key: string): Promise<void>
  clear(pattern: string): Promise<number>
  increment?(key: string, by?: number): Promise<number>
}