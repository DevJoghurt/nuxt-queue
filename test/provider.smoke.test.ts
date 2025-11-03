import { describe, it, expect } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils'

// v0.4 smoke test: boot playground and verify flow start with v0.4 schema

await setup({
  rootDir: './playground',
  server: true,
})

const run = process.env.REDIS_E2E ? it : it.skip

describe('v0.4 QueueProvider smoke', () => {
  run('starts a flow and returns v0.4 response with flowId', async () => {
    const flowId = 'resize-flow'
    const res = await $fetch(`/api/_queue/flows/${flowId}/start`, {
      method: 'POST',
      body: { ok: true },
    }) as any

    expect(res).toBeDefined()
    expect(res.id).toBeTypeOf('string')
    expect(res.flowId).toBeTypeOf('string') // v0.4: flowId is the runId
    expect(res.step).toBe('resize')
    expect(res.queue).toBeDefined()
  })

  run('emits v0.4 event schema with runId and flowName', async () => {
    const flowId = 'resize-flow'
    const res = await $fetch(`/api/_queue/flows/${flowId}/start`, {
      method: 'POST',
      body: { ok: true },
    }) as any

    // Wait for events to be written
    await new Promise(r => setTimeout(r, 1000))

    // Fetch events from flow stream
    const events = await $fetch<any[]>(`/api/_flows/${flowId}/${res.flowId}`)

    expect(Array.isArray(events)).toBe(true)
    expect(events.length).toBeGreaterThan(0)

    // Verify v0.4 schema
    events.forEach((e: any) => {
      expect(e.type).toBeDefined()
      expect(e.runId).toBe(res.flowId)
      expect(e.flowName).toBe(flowId)
    })
  })
})
