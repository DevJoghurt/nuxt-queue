import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { setup, $fetch } from '@nuxt/test-utils/e2e'

describe('memory store adapter', async () => {
  await setup({
    rootDir: resolve(__dirname, '../fixtures/base'),
    server: true,
  })

  describe('event storage', () => {
    it('appends and reads events', async () => {
      const subject = 'nq:test:events'
      const event = {
        type: 'test.event',
        data: { message: 'hello' },
        timestamp: new Date().toISOString(),
      }

      await $fetch('/api/test/store/append', {
        method: 'POST',
        body: { subject, event },
      })

      const { events } = await $fetch<any>('/api/test/store/read', {
        query: { subject },
      })

      expect(events).toBeDefined()
      expect(Array.isArray(events)).toBe(true)
      expect(events.length).toBeGreaterThan(0)
      expect(events[events.length - 1].type).toBe('test.event')
    })
  })

  describe('key-value storage', () => {
    it('sets and gets values', async () => {
      await $fetch('/api/test/store/kv-set', {
        method: 'POST',
        body: { key: 'test:key', value: { value: 'test' } },
      })

      const { value } = await $fetch<any>('/api/test/store/kv-get', {
        query: { key: 'test:key' },
      })

      expect(value).toBeDefined()
      expect(value.value).toBe('test')
    })

    it.skip('handles TTL expiration', async () => {
      // Skip: Memory adapter does not implement TTL expiration
      await $fetch('/api/test/store/kv-set', {
        method: 'POST',
        body: { key: 'test:ttl', value: { value: 'expires' }, ttl: 1000 },
      })

      const { value: immediate } = await $fetch<any>('/api/test/store/kv-get', {
        query: { key: 'test:ttl' },
      })
      expect(immediate).toBeDefined()

      // Wait for expiration
      await new Promise(r => setTimeout(r, 1500))

      const { value: expired } = await $fetch<any>('/api/test/store/kv-get', {
        query: { key: 'test:ttl' },
      })
      expect(expired).toBeNull()
    })

    it('stores different data types', async () => {
      await $fetch('/api/test/store/kv-set', {
        method: 'POST',
        body: { key: 'test:string', value: 'hello' },
      })
      await $fetch('/api/test/store/kv-set', {
        method: 'POST',
        body: { key: 'test:number', value: 42 },
      })
      await $fetch('/api/test/store/kv-set', {
        method: 'POST',
        body: { key: 'test:object', value: { nested: { value: true } } },
      })

      const { value: str } = await $fetch<any>('/api/test/store/kv-get', { query: { key: 'test:string' } })
      const { value: num } = await $fetch<any>('/api/test/store/kv-get', { query: { key: 'test:number' } })
      const { value: obj } = await $fetch<any>('/api/test/store/kv-get', { query: { key: 'test:object' } })

      expect(str).toBe('hello')
      expect(num).toBe(42)
      expect(obj).toEqual({ nested: { value: true } })
    })
  })
})
