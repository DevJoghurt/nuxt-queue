import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeAll } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'
import { canConnectRedis } from './helpers/redis'

let redisAvailable = false

describe('v0.4 flows registry and start', async () => {
  beforeAll(async () => {
    redisAvailable = await canConnectRedis()
  })

  await setup({
    rootDir: fileURLToPath(new URL('./fixtures/flows', import.meta.url)),
  })

  it('exposes flows index with v0.4 analyzed structure', async () => {
    const flows = await $fetch<any[]>('/api/_flows')
    expect(Array.isArray(flows)).toBe(true)

    // Should include our sample-flow
    const sampleFlow = flows.find(f => f.id === 'sample-flow')
    expect(sampleFlow).toBeDefined()
    expect(sampleFlow.analyzed).toBeDefined()
    expect(sampleFlow.analyzed.levels).toBeDefined()
    expect(sampleFlow.analyzed.steps).toBeDefined()
  })

  it('starts a flow and returns flowId (runId)', async () => {
    if (!redisAvailable) return

    const res = await $fetch<any>('/api/_queue/flows/sample-flow/start', { method: 'POST' })
    expect(res).toMatchObject({ queue: 'testflow', step: 'start' })
    expect(res.id).toBeTruthy()
    expect(res.flowId).toBeTruthy() // v0.4: flowId is the runId
  })

  it('orchestrates next step via ctx.flow.emit() when Redis is available', async () => {
    if (!redisAvailable) return

    // Start the flow
    const result = await $fetch<any>('/api/_queue/flows/sample-flow/start', { method: 'POST' })

    // Poll the queue to confirm 'next' step was enqueued via emit
    const maxAttempts = 20
    let found = false
    for (let i = 0; i < maxAttempts; i++) {
      const data = await $fetch<any>('/api/_queue/testflow/job', {
        query: { filter: ['waiting', 'active', 'completed'], limit: 50 },
      })
      const jobs = (data?.jobs || []) as Array<{ name: string, id: string }>
      const nextJob = jobs.find(j => j.name === 'next')
      if (nextJob) {
        // v0.4: Verify idempotent jobId pattern (runId__stepName)
        expect(nextJob.id).toBe(`${result.flowId}__next`)
        found = true
        break
      }
      await new Promise(r => setTimeout(r, 300))
    }
    expect(found).toBe(true)
  })

  it('emits v0.4 event schema with runId and flowName', async () => {
    if (!redisAvailable) return

    const result = await $fetch<any>('/api/_queue/flows/sample-flow/start', { method: 'POST' })

    // Wait for events to be written
    await new Promise(r => setTimeout(r, 1000))

    // Fetch events from flow stream
    const events = await $fetch<any[]>(`/api/_flows/sample-flow/${result.flowId}`)

    expect(events.length).toBeGreaterThan(0)

    // Verify v0.4 schema
    events.forEach((e: any) => {
      expect(e.type).toBeDefined()
      expect(e.runId).toBe(result.flowId)
      expect(e.flowName).toBe('sample-flow')
      expect(e.id).toBeDefined() // Redis stream ID
      expect(e.ts).toBeDefined() // ISO timestamp
    })
  })
})
