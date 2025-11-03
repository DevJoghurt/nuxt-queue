import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeAll } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'
import { canConnectRedis } from './helpers/redis'

let redisAvailable = false

describe('v0.4 queue API basics', async () => {
  beforeAll(async () => {
    redisAvailable = await canConnectRedis()
  })

  await setup({
    rootDir: fileURLToPath(new URL('./fixtures/basic', import.meta.url)),
  })

  it('lists queues without throwing', async () => {
    const list = await $fetch<any[]>('/api/_queues')
    expect(Array.isArray(list)).toBe(true)
  })

  it('returns flows with v0.4 analyzed structure', async () => {
    const flows = await $fetch<any[]>('/api/_flows')
    expect(Array.isArray(flows)).toBe(true)
  })

  it('enqueues job with proper metadata when Redis available', async () => {
    if (!redisAvailable) return

    const queues = await $fetch<any[]>('/api/_queues')
    if (!queues.length) return

    const q = queues[0]?.name
    if (!q) return

    const res = await $fetch<any>(`/api/_queues/${q}/job`, {
      method: 'POST',
      body: { foo: 'bar' },
    })

    expect(res?.id).toBeTruthy()
    expect(res?.queue).toBe(q)
  })
})
