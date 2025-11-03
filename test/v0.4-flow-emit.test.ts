import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeAll } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'
import { canConnectRedis } from './helpers/redis'

let redisAvailable = false

describe('v0.4 flow.emit() functionality', async () => {
  beforeAll(async () => {
    redisAvailable = await canConnectRedis()
  })

  await setup({
    rootDir: fileURLToPath(new URL('./fixtures/flows', import.meta.url)),
  })

  it('should trigger next step via ctx.flow.emit()', async () => {
    if (!redisAvailable) return

    const result = await $fetch<any>('/api/_queue/flows/sample-flow/start', { method: 'POST' })

    // Wait for flow to process and emit trigger
    await new Promise(r => setTimeout(r, 3000))

    // Check if 'next' step was enqueued
    const jobs = await $fetch<any>('/api/_queue/testflow/job', {
      query: { filter: ['waiting', 'active', 'completed'], limit: 50 },
    })

    const nextStepJob = jobs.jobs?.find((j: any) => j.name === 'next')
    expect(nextStepJob).toBeDefined()
    expect(nextStepJob.data.flowId).toBe(result.flowId)
  })

  it('should emit "emit" event type when ctx.flow.emit() is called', async () => {
    if (!redisAvailable) return

    const result = await $fetch<any>('/api/_queue/flows/sample-flow/start', { method: 'POST' })

    // Wait for emit event
    await new Promise(r => setTimeout(r, 2000))

    const events = await $fetch<any[]>(`/api/_flows/sample-flow/${result.flowId}`)

    const emitEvent = events.find((e: any) => e.type === 'emit')
    expect(emitEvent).toBeDefined()
    expect(emitEvent).toMatchObject({
      type: 'emit',
      runId: result.flowId,
      flowName: 'sample-flow',
    })
  })

  it('should use idempotent jobId for flow steps', async () => {
    if (!redisAvailable) return

    const result = await $fetch<any>('/api/_queue/flows/sample-flow/start', { method: 'POST' })
    const runId = result.flowId

    // Wait for next step to be enqueued
    await new Promise(r => setTimeout(r, 3000))

    const jobs = await $fetch<any>('/api/_queue/testflow/job', {
      query: { filter: ['waiting', 'active', 'completed'], limit: 50 },
    })

    const nextStepJob = jobs.jobs?.find((j: any) => j.name === 'next')
    expect(nextStepJob).toBeDefined()

    // JobId should follow pattern: runId__stepName
    expect(nextStepJob.id).toBe(`${runId}__next`)
  })

  it('should preserve flowId and flowName across steps', async () => {
    if (!redisAvailable) return

    const result = await $fetch<any>('/api/_queue/flows/sample-flow/start', { method: 'POST' })

    // Wait for next step to process
    await new Promise(r => setTimeout(r, 4000))

    const events = await $fetch<any[]>(`/api/_flows/sample-flow/${result.flowId}`)

    // Filter step events
    const stepEvents = events.filter((e: any) =>
      e.type === 'step.started' || e.type === 'step.completed',
    )

    // All step events should have same runId and flowName
    stepEvents.forEach((e: any) => {
      expect(e.runId).toBe(result.flowId)
      expect(e.flowName).toBe('sample-flow')
    })
  })

  it('should handle multiple emit calls in sequence', async () => {
    if (!redisAvailable) return

    const result = await $fetch<any>('/api/_queue/flows/sample-flow/start', { method: 'POST' })

    // Wait for flow to complete
    await new Promise(r => setTimeout(r, 5000))

    const events = await $fetch<any[]>(`/api/_flows/sample-flow/${result.flowId}`)

    // Should have multiple emit events (from start and next steps)
    const emitEvents = events.filter((e: any) => e.type === 'emit')
    expect(emitEvents.length).toBeGreaterThanOrEqual(2)
  })
})
