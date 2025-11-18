import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { setup, $fetch } from '@nuxt/test-utils/e2e'

describe('flow engine', async () => {
  await setup({
    rootDir: resolve(__dirname, '../fixtures/base'),
    server: true,
  })

  describe.skip('flow lifecycle', () => {
    // Skip: Flow registration during test setup needs investigation
    // Issue: Flows are not being found by useFlowEngine during e2e tests
    it('starts a flow and returns flowId', async () => {
      const result = await $fetch<any>('/api/test/flow/start', {
        method: 'POST',
        body: {
          flowName: 'basic-flow',
          payload: { test: 'start' },
        },
      })

      expect(result).toBeDefined()
      expect(result.flowId).toBeDefined()
      expect(result.step).toBe('start')
      expect(result.queue).toBe('flows')
    })

    it('executes flow steps in sequence', async () => {
      const result = await $fetch<any>('/api/test/flow/start', {
        method: 'POST',
        body: {
          flowName: 'basic-flow',
          payload: { test: 'sequence' },
        },
      })

      // Wait for flow to complete
      await new Promise(r => setTimeout(r, 3000))

      const { jobs } = await $fetch<any>('/api/test/queue/get-jobs', {
        query: { queue: 'flows', filter: ['completed'], limit: 50 },
      })
      const flowJobs = jobs.filter((j: any) => j.data?.flowId === result.flowId)

      expect(flowJobs.length).toBeGreaterThanOrEqual(1)
    })

    it('handles parallel flow execution', async () => {
      const result = await $fetch<any>('/api/test/flow/start', {
        method: 'POST',
        body: {
          flowName: 'parallel-flow',
          payload: { test: 'parallel' },
        },
      })

      // Wait for flow to complete
      await new Promise(r => setTimeout(r, 4000))

      const { jobs } = await $fetch<any>('/api/test/queue/get-jobs', {
        query: { queue: 'flows', filter: ['completed'], limit: 50 },
      })
      const flowJobs = jobs.filter((j: any) => j.data?.flowId === result.flowId)

      // Should have multiple steps
      expect(flowJobs.length).toBeGreaterThanOrEqual(2)
    })
  })
})
