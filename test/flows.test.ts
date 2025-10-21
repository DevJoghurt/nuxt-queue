import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeAll } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'
import { canConnectRedis } from './helpers/redis'

let redisAvailable = false

describe('flows registry and start', async () => {
  beforeAll(async () => {
    redisAvailable = await canConnectRedis()
  })

  await setup({
    rootDir: fileURLToPath(new URL('./fixtures/flows', import.meta.url)),
  })

  it('exposes flows index', async () => {
    const flows = await $fetch<any[]>('/api/_queue/flows')
    expect(Array.isArray(flows)).toBe(true)
    // Should include our sample-flow
    const ids = flows.map((f: any) => f.id)
    expect(ids).toContain('sample-flow')
  })

  it('starts a flow main step when Redis is available', async () => {
    if (!redisAvailable) return
    const res = await $fetch<any>('/api/_queue/flows/sample-flow/start', { method: 'POST' })
    expect(res).toMatchObject({ queue: 'testflow', step: 'start' })
    expect(res.id).toBeTruthy()
  })

  it('orchestrates next step on trigger when Redis is available', async () => {
    if (!redisAvailable) return
    // Start the flow (adds job with name 'start')
    await $fetch<any>('/api/_queue/flows/sample-flow/start', { method: 'POST' })
    // Poll the queue jobs to confirm a job with name 'next' has been enqueued by orchestrator
    const maxAttempts = 20
    let found = false
    for (let i = 0; i < maxAttempts; i++) {
      // Query waiting + active + completed to catch the orchestrated job quickly
      const data = await $fetch<any>(`/api/_queue/testflow/job`, { query: { filter: ['waiting', 'active', 'completed'], limit: 50 } })
      const jobs = (data?.jobs || []) as Array<{ name: string }>
      if (jobs.some(j => j.name === 'next')) {
        found = true
        break
      }
      // small backoff
      await new Promise(r => setTimeout(r, 300))
    }
    expect(found).toBe(true)
  })
})
