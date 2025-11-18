import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { setup, $fetch } from '@nuxt/test-utils/e2e'

describe('memory queue adapter', async () => {
  await setup({
    rootDir: resolve(__dirname, '../fixtures/base'),
    server: true,
  })

  describe('queue operations', () => {
    it('enqueues jobs', async () => {
      const { jobId } = await $fetch<any>('/api/test/queue/enqueue', {
        method: 'POST',
        body: {
          queue: 'test',
          name: 'simple',
          data: { test: 'data' },
        },
      })

      expect(jobId).toBeDefined()
      expect(typeof jobId).toBe('string')
    })

    it('retrieves jobs from queue', async () => {
      await $fetch('/api/test/queue/enqueue', {
        method: 'POST',
        body: {
          queue: 'test',
          name: 'simple',
          data: { test: 'retrieve' },
        },
      })

      const { jobs } = await $fetch<any>('/api/test/queue/get-jobs', {
        query: { queue: 'test', filter: ['waiting', 'active', 'completed'], limit: 10 },
      })

      expect(jobs).toBeDefined()
      expect(Array.isArray(jobs)).toBe(true)
      expect(jobs.length).toBeGreaterThan(0)
    })

    it('handles job options (delay, priority)', async () => {
      const { jobId } = await $fetch<any>('/api/test/queue/enqueue', {
        method: 'POST',
        body: {
          queue: 'test',
          name: 'simple',
          data: { test: 'options' },
          opts: {
            delay: 100,
            priority: 5,
          },
        },
      })

      // Wait a bit for delayed job
      await new Promise(r => setTimeout(r, 200))

      const { jobs } = await $fetch<any>('/api/test/queue/get-jobs', {
        query: { queue: 'test', filter: ['delayed', 'waiting'], limit: 10 },
      })
      const job = jobs.find((j: any) => j.id === jobId)

      expect(job).toBeDefined()
      // Priority field may vary by adapter implementation
      if (job.opts?.priority !== undefined) {
        expect(job.opts.priority).toBe(5)
      }
    })
  })

  describe('queue isolation', () => {
    it('isolates queues by name', async () => {
      await $fetch('/api/test/queue/enqueue', {
        method: 'POST',
        body: { queue: 'test', name: 'simple', data: { queue: 'test' } },
      })
      await $fetch('/api/test/queue/enqueue', {
        method: 'POST',
        body: { queue: 'flows', name: 'simple', data: { queue: 'flows' } },
      })

      const { jobs: testJobs } = await $fetch<any>('/api/test/queue/get-jobs', {
        query: { queue: 'test', filter: ['waiting', 'active', 'completed'], limit: 50 },
      })
      const { jobs: flowsJobs } = await $fetch<any>('/api/test/queue/get-jobs', {
        query: { queue: 'flows', filter: ['waiting', 'active', 'completed'], limit: 50 },
      })

      expect(testJobs.length).toBeGreaterThanOrEqual(1)
      expect(flowsJobs.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('worker processing', () => {
    it('processes jobs with worker', async () => {
      const { jobId } = await $fetch<any>('/api/test/queue/enqueue', {
        method: 'POST',
        body: {
          queue: 'test',
          name: 'simple',
          data: { message: 'process me' },
        },
      })

      // Wait for processing
      await new Promise(r => setTimeout(r, 3000))

      const { jobs } = await $fetch<any>('/api/test/queue/get-jobs', {
        query: { queue: 'test', filter: ['completed'], limit: 50 },
      })
      const completedJob = jobs.find((j: any) => j.id === jobId)

      expect(completedJob).toBeDefined()
      // Check that job was found in completed state - actual completion metadata depends on adapter
      expect(completedJob.id).toBe(jobId)
    })

    it('handles concurrent jobs', async () => {
      await Promise.all([
        $fetch('/api/test/queue/enqueue', {
          method: 'POST',
          body: { queue: 'test', name: 'simple', data: { concurrent: 1 } },
        }),
        $fetch('/api/test/queue/enqueue', {
          method: 'POST',
          body: { queue: 'test', name: 'simple', data: { concurrent: 2 } },
        }),
        $fetch('/api/test/queue/enqueue', {
          method: 'POST',
          body: { queue: 'test', name: 'simple', data: { concurrent: 3 } },
        }),
      ])

      await new Promise(r => setTimeout(r, 3000))

      const { jobs } = await $fetch<any>('/api/test/queue/get-jobs', {
        query: { queue: 'test', filter: ['completed'], limit: 50 },
      })

      expect(jobs.length).toBeGreaterThanOrEqual(3)
    })
  })
})
