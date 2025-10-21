import { describe, it, expect, vi } from 'vitest'

// Provide a virtual mock for Nuxt's #imports in test environment
vi.mock('#imports', () => {
  const store = new Map<string, any>()
  return {
    useRuntimeConfig: () => ({
      queue: {
        state: { name: 'redis', namespace: 'nq' },
      },
    }),
    useStorage: () => ({
      async getItem<T = any>(key: string) {
        return (store.has(key) ? store.get(key) : null) as T | null
      },
      async setItem<T = any>(key: string, value: T) {
        store.set(key, value)
      },
      async removeItem(key: string) {
        store.delete(key)
      },
      async getKeys(prefix: string) {
        const p = String(prefix || '')
        return Array.from(store.keys()).filter(k => k.startsWith(p))
      },
    }),
  }
}, { virtual: true })

describe('StateProvider (redis via unstorage)', () => {
  it('exposes get/set/delete/patch', async () => {
    const { useStateProvider } = await import('../src/runtime/server/providers/state')
    const state = useStateProvider()
    const key = `test:${Date.now()}`
    expect(await state.get(key)).toBeNull()
    await state.set(key, { a: 1 })
    expect(await state.get<any>(key)).toEqual({ a: 1 })
    const patched = await state.patch<any>(key, prev => ({ ...(prev || {}), b: 2 }))
    expect(patched).toEqual({ a: 1, b: 2 })
    await state.delete(key)
    expect(await state.get(key)).toBeNull()
  })
})
