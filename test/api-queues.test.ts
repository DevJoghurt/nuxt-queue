import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeAll } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'
import { canConnectRedis } from './helpers/redis'

let redisAvailable = false

describe('queue API basics', async () => {
  beforeAll(async () => {
    redisAvailable = await canConnectRedis()
  })

  await setup({
    rootDir: fileURLToPath(new URL('./fixtures/basic', import.meta.url)),
  })

  it('lists queues without throwing', async () => {
    // this endpoint does not require Redis to be connected to return an array
    const list = await $fetch<any[]>('/api/_queue')
    expect(Array.isArray(list)).toBe(true)
  })

  it('returns 200 for flows index even if no flows', async () => {
    const flows = await $fetch<any[]>('/api/_queue/flows')
    expect(Array.isArray(flows)).toBe(true)
  })

  it('job post might require Redis; only run when available', async () => {
    if (!redisAvailable) return
    // Enqueue any job on any queue if present
    const queues = await $fetch<any[]>('/api/_queue')
    if (!queues.length) return
    const q = queues[0]?.name
    if (!q) return
    const res = await $fetch<any>(`/api/_queue/${q}/job`, { method: 'POST', body: { foo: 'bar' } })
    expect(res?.id).toBeTruthy()
  })
})
