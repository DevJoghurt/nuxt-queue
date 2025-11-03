import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeAll } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'
import { canConnectRedis } from './helpers/redis'

let redisAvailable = false

describe('v0.4 event schema and streams', async () => {
  beforeAll(async () => {
    redisAvailable = await canConnectRedis()
  })

  await setup({
    rootDir: fileURLToPath(new URL('./fixtures/flows', import.meta.url)),
  })

  it('should emit flow.start event with v0.4 schema', async () => {
    if (!redisAvailable) return

    const result = await $fetch<any>('/api/_queue/flows/sample-flow/start', {
      method: 'POST',
      body: { testInput: 'value' },
    })

    expect(result.flowId).toBeTruthy()

    // Wait a bit for event to be emitted
    await new Promise(r => setTimeout(r, 500))

    // Fetch events from the flow stream
    const events = await $fetch<any[]>(`/api/_flows/sample-flow/${result.flowId}`)

    // Should have at least flow.start event
    const startEvent = events.find((e: any) => e.type === 'flow.start')
    expect(startEvent).toBeDefined()
    expect(startEvent).toMatchObject({
      type: 'flow.start',
      runId: result.flowId,
      flowName: 'sample-flow',
    })
    expect(startEvent.id).toBeTruthy()
    expect(startEvent.ts).toBeTruthy()
  })

  it('should emit step.started event with v0.4 schema', async () => {
    if (!redisAvailable) return

    const result = await $fetch<any>('/api/_queue/flows/sample-flow/start', { method: 'POST' })

    // Wait for step to start
    await new Promise(r => setTimeout(r, 1000))

    const events = await $fetch<any[]>(`/api/_flows/sample-flow/${result.flowId}`)

    const stepStarted = events.find((e: any) => e.type === 'step.started')
    expect(stepStarted).toBeDefined()
    expect(stepStarted).toMatchObject({
      type: 'step.started',
      runId: result.flowId,
      flowName: 'sample-flow',
      stepName: 'start',
    })
    expect(stepStarted.stepId).toBeTruthy()
    expect(stepStarted.attempt).toBe(1)
  })

  it('should emit step.completed event with v0.4 schema', async () => {
    if (!redisAvailable) return

    const result = await $fetch<any>('/api/_queue/flows/sample-flow/start', { method: 'POST' })

    // Wait for step to complete
    await new Promise(r => setTimeout(r, 2000))

    const events = await $fetch<any[]>(`/api/_flows/sample-flow/${result.flowId}`)

    const stepCompleted = events.find((e: any) => e.type === 'step.completed')
    expect(stepCompleted).toBeDefined()
    expect(stepCompleted).toMatchObject({
      type: 'step.completed',
      runId: result.flowId,
      flowName: 'sample-flow',
      stepName: 'start',
    })
    expect(stepCompleted.stepId).toBeTruthy()
    expect(stepCompleted.attempt).toBe(1)
    expect(stepCompleted.data).toMatchObject({ result: { ok: true } })
  })

  it('should use runId-based stream naming', async () => {
    if (!redisAvailable) return

    const result = await $fetch<any>('/api/_queue/flows/sample-flow/start', { method: 'POST' })
    const runId = result.flowId

    // The stream should be accessible by runId
    const events = await $fetch<any[]>(`/api/_flows/sample-flow/${runId}`)

    expect(Array.isArray(events)).toBe(true)
    expect(events.length).toBeGreaterThan(0)

    // All events should have the same runId
    events.forEach((e: any) => {
      expect(e.runId).toBe(runId)
    })
  })

  it('should emit events in correct order', async () => {
    if (!redisAvailable) return

    const result = await $fetch<any>('/api/_queue/flows/sample-flow/start', { method: 'POST' })

    // Wait for completion
    await new Promise(r => setTimeout(r, 2000))

    const events = await $fetch<any[]>(`/api/_flows/sample-flow/${result.flowId}`)

    // Find relevant events
    const flowStart = events.find((e: any) => e.type === 'flow.start')
    const stepStarted = events.find((e: any) => e.type === 'step.started')
    const stepCompleted = events.find((e: any) => e.type === 'step.completed')

    expect(flowStart).toBeDefined()
    expect(stepStarted).toBeDefined()
    expect(stepCompleted).toBeDefined()

    // Timestamps should be in order
    const flowStartTime = new Date(flowStart.ts).getTime()
    const stepStartedTime = new Date(stepStarted.ts).getTime()
    const stepCompletedTime = new Date(stepCompleted.ts).getTime()

    expect(stepStartedTime).toBeGreaterThanOrEqual(flowStartTime)
    expect(stepCompletedTime).toBeGreaterThanOrEqual(stepStartedTime)
  })

  it('should include stepId for step events', async () => {
    if (!redisAvailable) return

    const result = await $fetch<any>('/api/_queue/flows/sample-flow/start', { method: 'POST' })

    await new Promise(r => setTimeout(r, 2000))

    const events = await $fetch<any[]>(`/api/_flows/sample-flow/${result.flowId}`)

    const stepEvents = events.filter((e: any) =>
      e.type === 'step.started' || e.type === 'step.completed' || e.type === 'step.failed',
    )

    stepEvents.forEach((e: any) => {
      expect(e.stepId).toBeTruthy()
      expect(e.stepName).toBeTruthy()
      expect(typeof e.attempt).toBe('number')
      expect(e.attempt).toBeGreaterThan(0)
    })
  })

  it('should support SSE streaming for flow events', { timeout: 10000 }, async () => {
    if (!redisAvailable) return

    const result = await $fetch<any>('/api/_queue/flows/sample-flow/start', { method: 'POST' })
    const runId = result.flowId

    // Test that SSE endpoint exists and returns correct content-type
    const response = await fetch(`http://localhost:3000/api/_flows/sample-flow/${runId}/stream`)

    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(response.headers.get('cache-control')).toBe('no-cache')
    expect(response.headers.get('connection')).toBe('keep-alive')
  })
})
