import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'

describe('basic queue functionality', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('./fixtures/basic', import.meta.url)),
  })

  describe('registry and discovery', () => {
    it('lists queues without throwing', async () => {
      const list = await $fetch<any[]>('/api/_queues')
      expect(Array.isArray(list)).toBe(true)
    })

    it('returns flows with analyzed structure', async () => {
      const flows = await $fetch<any[]>('/api/_flows')
      expect(Array.isArray(flows)).toBe(true)

      flows.forEach((flow: any) => {
        if (flow.analyzed) {
          expect(flow.analyzed.levels).toBeDefined()
          expect(flow.analyzed.steps).toBeDefined()
          expect(flow.analyzed.maxLevel).toBeDefined()
        }
      })
    })
  })
})
