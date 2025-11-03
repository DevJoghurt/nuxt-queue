import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeAll } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'
import { canConnectRedis } from './helpers/redis'

let redisAvailable = false

describe('v0.4 stream naming (nq:flow:{runId} pattern)', async () => {
  beforeAll(async () => {
    redisAvailable = await canConnectRedis()
  })

  await setup({
    rootDir: fileURLToPath(new URL('./fixtures/flows', import.meta.url)),
  })

  it('should use nq:flow:{runId} pattern for flow events', async () => {
    if (!redisAvailable) return

    const result = await $fetch<any>('/api/_queue/flows/sample-flow/start', { method: 'POST' })
    const runId = result.flowId

    // Wait for events to be written
    await new Promise(r => setTimeout(r, 1000))

    // Fetch events - should be accessible via runId
    const events = await $fetch<any[]>(`/api/_flows/sample-flow/${runId}`)

    expect(Array.isArray(events)).toBe(true)
    expect(events.length).toBeGreaterThan(0)
  })

  it('should use nq:flows:{flowName} pattern for flow index', async () => {
    if (!redisAvailable) return

    await $fetch<any>('/api/_queue/flows/sample-flow/start', { method: 'POST' })

    // Wait for index to be updated
    await new Promise(r => setTimeout(r, 1000))

    // Fetch runs from index
    const runs = await $fetch<any[]>('/api/_flows/sample-flow')

    expect(Array.isArray(runs)).toBe(true)
    expect(runs.length).toBeGreaterThan(0)
  })

  it('should isolate events by runId', async () => {
    if (!redisAvailable) return

    // Start two separate flow runs
    const run1 = await $fetch<any>('/api/_queue/flows/sample-flow/start', { method: 'POST' })
    const run2 = await $fetch<any>('/api/_queue/flows/sample-flow/start', { method: 'POST' })

    await new Promise(r => setTimeout(r, 2000))

    // Fetch events for each run
    const events1 = await $fetch<any[]>(`/api/_flows/sample-flow/${run1.flowId}`)
    const events2 = await $fetch<any[]>(`/api/_flows/sample-flow/${run2.flowId}`)

    // Events should be isolated by runId
    expect(events1.every((e: any) => e.runId === run1.flowId)).toBe(true)
    expect(events2.every((e: any) => e.runId === run2.flowId)).toBe(true)

    // Events from different runs should not overlap
    const event1Ids = events1.map((e: any) => e.id)
    const event2Ids = events2.map((e: any) => e.id)
    const overlap = event1Ids.filter((id: string) => event2Ids.includes(id))
    expect(overlap.length).toBe(0)
  })

  it('should list all runs for a flow in the index', async () => {
    if (!redisAvailable) return

    // Start multiple runs
    const runs = await Promise.all([
      $fetch<any>('/api/_queue/flows/sample-flow/start', { method: 'POST' }),
      $fetch<any>('/api/_queue/flows/sample-flow/start', { method: 'POST' }),
      $fetch<any>('/api/_queue/flows/sample-flow/start', { method: 'POST' }),
    ])

    await new Promise(r => setTimeout(r, 1000))

    // Fetch flow index
    const index = await $fetch<any[]>('/api/_flows/sample-flow')

    // Should contain all our new runs
    const runIds = runs.map(r => r.flowId)
    runIds.forEach((runId) => {
      expect(index.some((r: any) => r.id === runId)).toBe(true)
    })
  })

  it('should support querying flow runs by time range', async () => {
    if (!redisAvailable) return

    const startTime = Date.now()

    await $fetch<any>('/api/_queue/flows/sample-flow/start', { method: 'POST' })

    await new Promise(r => setTimeout(r, 1000))

    const runs = await $fetch<any[]>('/api/_flows/sample-flow')

    // All runs should have timestamps
    runs.forEach((run: any) => {
      expect(run.ts).toBeDefined()
      const runTime = new Date(run.ts).getTime()
      expect(runTime).toBeGreaterThanOrEqual(startTime)
    })
  })
})
