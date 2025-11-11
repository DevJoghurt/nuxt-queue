import { useStorage, useRuntimeConfig } from '#imports'
import type { StateProvider, StorageLike } from '../types'

function nsKey(ns: string, key: string) {
  if (!key) return ns
  return key.startsWith(ns + ':') ? key : `${ns}:${key}`
}

export function createRedisStateProvider(namespace?: string): StateProvider {
  const storage = useStorage('redis') as unknown as StorageLike
  const ns = namespace || (useRuntimeConfig() as any)?.queue?.state?.namespace || 'nq'

  return {
    async get<T = any>(key: string): Promise<T | null> {
      return storage.getItem<T>(nsKey(ns, key))
    },
    async set<T = any>(key: string, value: T, opts?: { ttl?: number }): Promise<void> {
      await storage.setItem(nsKey(ns, key), value, { ttl: opts?.ttl })
    },
    async delete(key: string): Promise<void> {
      await storage.removeItem(nsKey(ns, key))
    },
    async list(prefix: string, opts?: { limit?: number }): Promise<{ keys: string[] }> {
      const base = nsKey(ns, prefix)
      const keys = await storage.getKeys(base)
      const filtered = keys.filter(k => k.startsWith(base)).slice(0, opts?.limit || keys.length)
      return { keys: filtered }
    },
    async patch<T = any>(key: string, updater: (prev: T | null) => T, opts?: { retries?: number }): Promise<T> {
      const retries = Math.max(0, opts?.retries ?? 3)
      const k = nsKey(ns, key)
      let lastErr: any
      for (let i = 0; i <= retries; i++) {
        try {
          const prev = await storage.getItem<T>(k)
          const next = updater(prev)
          await storage.setItem<T>(k, next)
          return next
        }
        catch (err) {
          lastErr = err
        }
      }
      throw lastErr || new Error('patch failed')
    },
  }
}
