import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'

describe('v0.4 registry endpoint', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('./fixtures/basic', import.meta.url)),
  })

  it('returns a compiled registry with v0.4 structure', async () => {
    const reg = await $fetch<any>('/api/_queues/registry')
    expect(reg).toBeDefined()
    expect(reg).toHaveProperty('workers')
    expect(reg).toHaveProperty('flows')
    expect(reg).toHaveProperty('eventIndex')

    // v0.4: eventIndex maps trigger names to steps
    expect(typeof reg.eventIndex).toBe('object')
  })

  it('exposes flow metadata with analyzed structure', async () => {
    const flows = await $fetch<any[]>('/api/_flows')
    expect(Array.isArray(flows)).toBe(true)

    // Each flow should have analyzed structure
    flows.forEach((flow: any) => {
      if (flow.analyzed) {
        expect(flow.analyzed.levels).toBeDefined()
        expect(flow.analyzed.steps).toBeDefined()
        expect(flow.analyzed.maxLevel).toBeDefined()
      }
    })
  })
})
