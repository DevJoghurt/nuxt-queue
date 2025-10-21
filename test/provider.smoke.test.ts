import { describe, it, expect } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils'

// Tiny smoke test: boot playground and ensure provider can enqueue a job via API

await setup({
  rootDir: './playground',
  server: true,
})

const run = process.env.REDIS_E2E ? it : it.skip

describe('QueueProvider smoke', () => {
  run('starts a flow and returns id', async () => {
    // Use flow start endpoint: playground has flow id 'resize-flow'
    const flowId = 'resize-flow'
    const res = await $fetch(`/api/_queue/flows/${flowId}/start`, {
      method: 'POST',
      body: { ok: true },
    }) as any
    expect(res).toBeDefined()
    expect(res.id).toBeTypeOf('string')
    expect(res.step).toBe('resize')
    expect(res.queue).toBeDefined()
  })
})
