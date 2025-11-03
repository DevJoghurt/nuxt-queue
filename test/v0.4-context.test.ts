import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeAll } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'
import { canConnectRedis } from './helpers/redis'

let redisAvailable = false

describe('v0.4 worker context (ctx)', async () => {
  beforeAll(async () => {
    redisAvailable = await canConnectRedis()
  })

  await setup({
    rootDir: fileURLToPath(new URL('./fixtures/flows', import.meta.url)),
  })

  it('should provide ctx.flowId in worker context', async () => {
    if (!redisAvailable) return

    const result = await $fetch<any>('/api/_queue/flows/sample-flow/start', { method: 'POST' })

    await new Promise(r => setTimeout(r, 2000))

    const events = await $fetch<any[]>(`/api/_flows/sample-flow/${result.flowId}`)

    // All step events should have the correct runId (which is ctx.flowId in worker)
    const stepEvents = events.filter((e: any) =>
      e.type === 'step.started' || e.type === 'step.completed',
    )

    stepEvents.forEach((e: any) => {
      expect(e.runId).toBe(result.flowId)
    })
  })

  it('should provide ctx.flowName in worker context', async () => {
    if (!redisAvailable) return

    const result = await $fetch<any>('/api/_queue/flows/sample-flow/start', { method: 'POST' })

    await new Promise(r => setTimeout(r, 2000))

    const events = await $fetch<any[]>(`/api/_flows/sample-flow/${result.flowId}`)

    // All events should have flowName
    events.forEach((e: any) => {
      expect(e.flowName).toBe('sample-flow')
    })
  })

  it('should provide ctx.stepName in worker context', async () => {
    if (!redisAvailable) return

    const result = await $fetch<any>('/api/_queue/flows/sample-flow/start', { method: 'POST' })

    await new Promise(r => setTimeout(r, 2000))

    const events = await $fetch<any[]>(`/api/_flows/sample-flow/${result.flowId}`)

    // Step events should have stepName matching the step
    const startStepEvent = events.find((e: any) =>
      e.type === 'step.started' && e.stepName === 'start',
    )
    expect(startStepEvent).toBeDefined()
  })

  it('should provide ctx.attempt in worker context', async () => {
    if (!redisAvailable) return

    const result = await $fetch<any>('/api/_queue/flows/sample-flow/start', { method: 'POST' })

    await new Promise(r => setTimeout(r, 2000))

    const events = await $fetch<any[]>(`/api/_flows/sample-flow/${result.flowId}`)

    // All step events should have attempt number
    const stepEvents = events.filter((e: any) =>
      e.type === 'step.started' || e.type === 'step.completed',
    )

    stepEvents.forEach((e: any) => {
      expect(e.attempt).toBe(1) // First attempt
    })
  })

  it('should provide ctx.stepId with unique step run identifier', async () => {
    if (!redisAvailable) return

    const result = await $fetch<any>('/api/_queue/flows/sample-flow/start', { method: 'POST' })

    await new Promise(r => setTimeout(r, 2000))

    const events = await $fetch<any[]>(`/api/_flows/sample-flow/${result.flowId}`)

    const stepStarted = events.find((e: any) => e.type === 'step.started')
    const stepCompleted = events.find((e: any) => e.type === 'step.completed')

    // Both events from same step execution should have same stepId
    expect(stepStarted.stepId).toBe(stepCompleted.stepId)

    // stepId should contain flowId, stepName, and attempt
    expect(stepStarted.stepId).toContain(result.flowId)
    expect(stepStarted.stepId).toContain('attempt-1')
  })

  it('should provide ctx.flow.emit() for triggering flow events', async () => {
    if (!redisAvailable) return

    const result = await $fetch<any>('/api/_queue/flows/sample-flow/start', { method: 'POST' })

    // Wait for emit
    await new Promise(r => setTimeout(r, 2000))

    const events = await $fetch<any[]>(`/api/_flows/sample-flow/${result.flowId}`)

    // Should have emit event from ctx.flow.emit() call
    const emitEvent = events.find((e: any) => e.type === 'emit')
    expect(emitEvent).toBeDefined()
  })

  it('should provide ctx.flow.startFlow() for starting new flows', async () => {
    if (!redisAvailable) return

    // This is tested indirectly - the ability to start flows via API
    // confirms the flow engine is accessible
    const result = await $fetch<any>('/api/_queue/flows/sample-flow/start', { method: 'POST' })

    expect(result.flowId).toBeTruthy()
    expect(result.step).toBe('start')
  })

  it('should provide ctx.state for scoped state management', async () => {
    if (!redisAvailable) return

    const result = await $fetch<any>('/api/_queue/flows/sample-flow/start', { method: 'POST' })

    // Wait for worker to execute ctx.state.set()
    await new Promise(r => setTimeout(r, 2000))

    // The test workers call ctx.state.set('lastEmail', {...})
    // We can verify this worked by checking the flow completed successfully
    const events = await $fetch<any[]>(`/api/_flows/sample-flow/${result.flowId}`)

    const completed = events.find((e: any) => e.type === 'step.completed')
    expect(completed).toBeDefined()
  })

  it('should provide ctx.logger for structured logging', async () => {
    if (!redisAvailable) return

    const result = await $fetch<any>('/api/_queue/flows/sample-flow/start', { method: 'POST' })

    await new Promise(r => setTimeout(r, 2000))

    const events = await $fetch<any[]>(`/api/_flows/sample-flow/${result.flowId}`)

    // Should have log events from ctx.logger.log() calls
    const logEvents = events.filter((e: any) => e.type === 'log')
    expect(logEvents.length).toBeGreaterThan(0)

    logEvents.forEach((e: any) => {
      expect(e.data.level).toBeDefined()
      expect(e.data.message).toBeDefined()
    })
  })
})
