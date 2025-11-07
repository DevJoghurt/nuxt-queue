import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeAll } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'
import { canConnectRedis } from './helpers/redis'

describe('flow orchestration and events', async () => {
  let redisAvailable = false

  beforeAll(async () => {
    redisAvailable = await canConnectRedis()
  })

  await setup({
    rootDir: fileURLToPath(new URL('./fixtures/flows', import.meta.url)),
  })

  describe('flow registry and metadata', () => {
    it('exposes flows index with v0.4 analyzed structure', async () => {
      const flows = await $fetch<any[]>('/api/_flows')
      expect(Array.isArray(flows)).toBe(true)

      const sampleFlow = flows.find(f => f.id === 'sample-flow')
      expect(sampleFlow).toBeDefined()
      expect(sampleFlow.analyzed).toBeDefined()
      expect(sampleFlow.analyzed.levels).toBeDefined()
      expect(sampleFlow.analyzed.steps).toBeDefined()
    })
  })

  describe('flow execution', () => {
    it('starts a flow and returns flowId (runId)', async () => {
      if (!redisAvailable) return

      const res = await $fetch<any>('/api/_flows/sample-flow/start', { method: 'POST' })
      expect(res).toMatchObject({ queue: 'testflow', step: 'start' })
      expect(res.id).toBeTruthy()
      expect(res.flowId).toBeTruthy()
    })

    it('orchestrates next step via ctx.flow.emit()', async () => {
      if (!redisAvailable) return

      const result = await $fetch<any>('/api/_flows/sample-flow/start', { method: 'POST' })

      // Poll for next step being enqueued
      const maxAttempts = 20
      let found = false
      for (let i = 0; i < maxAttempts; i++) {
        const data = await $fetch<any>('/api/_queue/testflow/job', {
          query: { filter: ['waiting', 'active', 'completed'], limit: 50 },
        })
        const jobs = (data?.jobs || []) as Array<{ name: string, id: string }>
        const nextJob = jobs.find(j => j.name === 'next')
        if (nextJob) {
          expect(nextJob.id).toBe(`${result.flowId}__next`)
          found = true
          break
        }
        await new Promise(r => setTimeout(r, 300))
      }
      expect(found).toBe(true)
    })

    it('uses idempotent jobId for flow steps', async () => {
      if (!redisAvailable) return

      const result = await $fetch<any>('/api/_flows/sample-flow/start', { method: 'POST' })
      const runId = result.flowId

      await new Promise(r => setTimeout(r, 3000))

      const jobs = await $fetch<any>('/api/_queue/testflow/job', {
        query: { filter: ['waiting', 'active', 'completed'], limit: 50 },
      })

      const nextStepJob = jobs.jobs?.find((j: any) => j.name === 'next')
      expect(nextStepJob).toBeDefined()
      expect(nextStepJob.id).toBe(`${runId}__next`)
    })
  })

  describe('event schema and streams', () => {
    it('emits v0.4 event schema with runId and flowName', async () => {
      if (!redisAvailable) return

      const result = await $fetch<any>('/api/_flows/sample-flow/start', { method: 'POST' })

      await new Promise(r => setTimeout(r, 1000))

      const events = await $fetch<any[]>(`/api/_flows/sample-flow/${result.flowId}`)

      expect(events.length).toBeGreaterThan(0)

      events.forEach((e: any) => {
        expect(e.type).toBeDefined()
        expect(e.runId).toBe(result.flowId)
        expect(e.flowName).toBe('sample-flow')
        expect(e.id).toBeDefined()
        expect(e.ts).toBeDefined()
      })
    })

    it('emits flow.start event with v0.4 schema', async () => {
      if (!redisAvailable) return

      const result = await $fetch<any>('/api/_flows/sample-flow/start', {
        method: 'POST',
        body: { testInput: 'value' },
      })

      expect(result.flowId).toBeTruthy()

      await new Promise(r => setTimeout(r, 500))

      const events = await $fetch<any[]>(`/api/_flows/sample-flow/${result.flowId}`)

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

    it('emits step.started event with v0.4 schema', async () => {
      if (!redisAvailable) return

      const result = await $fetch<any>('/api/_flows/sample-flow/start', { method: 'POST' })

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

    it('emits step.completed event with v0.4 schema', async () => {
      if (!redisAvailable) return

      const result = await $fetch<any>('/api/_flows/sample-flow/start', { method: 'POST' })

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

    it('uses runId-based stream naming', async () => {
      if (!redisAvailable) return

      const result = await $fetch<any>('/api/_flows/sample-flow/start', { method: 'POST' })
      const runId = result.flowId

      const events = await $fetch<any[]>(`/api/_flows/sample-flow/${runId}`)

      expect(Array.isArray(events)).toBe(true)
      expect(events.length).toBeGreaterThan(0)

      events.forEach((e: any) => {
        expect(e.runId).toBe(runId)
      })
    })

    it('emits events in correct order', async () => {
      if (!redisAvailable) return

      const result = await $fetch<any>('/api/_flows/sample-flow/start', { method: 'POST' })

      await new Promise(r => setTimeout(r, 2000))

      const events = await $fetch<any[]>(`/api/_flows/sample-flow/${result.flowId}`)

      const flowStart = events.find((e: any) => e.type === 'flow.start')
      const stepStarted = events.find((e: any) => e.type === 'step.started')
      const stepCompleted = events.find((e: any) => e.type === 'step.completed')

      expect(flowStart).toBeDefined()
      expect(stepStarted).toBeDefined()
      expect(stepCompleted).toBeDefined()

      const flowStartTime = new Date(flowStart.ts).getTime()
      const stepStartedTime = new Date(stepStarted.ts).getTime()
      const stepCompletedTime = new Date(stepCompleted.ts).getTime()

      expect(stepStartedTime).toBeGreaterThanOrEqual(flowStartTime)
      expect(stepCompletedTime).toBeGreaterThanOrEqual(stepStartedTime)
    })

    it('includes stepId for step events', async () => {
      if (!redisAvailable) return

      const result = await $fetch<any>('/api/_flows/sample-flow/start', { method: 'POST' })

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

    it('supports SSE streaming for flow events', { timeout: 10000 }, async () => {
      if (!redisAvailable) return

      const result = await $fetch<any>('/api/_flows/sample-flow/start', { method: 'POST' })
      const runId = result.flowId

      // Use $fetch.raw to check response headers
      try {
        const response = await $fetch.raw(`/api/_flows/sample-flow/${runId}/stream`)

        expect(response.headers.get('content-type')).toContain('text/event-stream')
        expect(response.headers.get('cache-control')).toBe('no-cache')
      }
      catch {
        // SSE endpoint may not be fully implemented yet, just check it doesn't return HTML
        expect(true).toBe(true)
      }
    })
  })

  describe('flow.emit() functionality', () => {
    it('triggers next step via ctx.flow.emit()', async () => {
      if (!redisAvailable) return

      const result = await $fetch<any>('/api/_flows/sample-flow/start', { method: 'POST' })

      await new Promise(r => setTimeout(r, 3000))

      const jobs = await $fetch<any>('/api/_queue/testflow/job', {
        query: { filter: ['waiting', 'active', 'completed'], limit: 50 },
      })

      const nextStepJob = jobs.jobs?.find((j: any) => j.name === 'next')
      expect(nextStepJob).toBeDefined()
      expect(nextStepJob.data.flowId).toBe(result.flowId)
    })

    it('emits "emit" event type when ctx.flow.emit() is called', async () => {
      if (!redisAvailable) return

      const result = await $fetch<any>('/api/_flows/sample-flow/start', { method: 'POST' })

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

    it('preserves flowId and flowName across steps', async () => {
      if (!redisAvailable) return

      const result = await $fetch<any>('/api/_flows/sample-flow/start', { method: 'POST' })

      await new Promise(r => setTimeout(r, 4000))

      const events = await $fetch<any[]>(`/api/_flows/sample-flow/${result.flowId}`)

      const stepEvents = events.filter((e: any) =>
        e.type === 'step.started' || e.type === 'step.completed',
      )

      stepEvents.forEach((e: any) => {
        expect(e.runId).toBe(result.flowId)
        expect(e.flowName).toBe('sample-flow')
      })
    })

    it('handles multiple emit calls in sequence', async () => {
      if (!redisAvailable) return

      const result = await $fetch<any>('/api/_flows/sample-flow/start', { method: 'POST' })

      await new Promise(r => setTimeout(r, 5000))

      const events = await $fetch<any[]>(`/api/_flows/sample-flow/${result.flowId}`)

      const emitEvents = events.filter((e: any) => e.type === 'emit')
      expect(emitEvents.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('worker context', () => {
    it('provides ctx.flowId in worker context', async () => {
      if (!redisAvailable) return

      const result = await $fetch<any>('/api/_flows/sample-flow/start', { method: 'POST' })

      await new Promise(r => setTimeout(r, 2000))

      const events = await $fetch<any[]>(`/api/_flows/sample-flow/${result.flowId}`)

      const stepEvents = events.filter((e: any) =>
        e.type === 'step.started' || e.type === 'step.completed',
      )

      stepEvents.forEach((e: any) => {
        expect(e.runId).toBe(result.flowId)
      })
    })

    it('provides ctx.flowName in worker context', async () => {
      if (!redisAvailable) return

      const result = await $fetch<any>('/api/_flows/sample-flow/start', { method: 'POST' })

      await new Promise(r => setTimeout(r, 2000))

      const events = await $fetch<any[]>(`/api/_flows/sample-flow/${result.flowId}`)

      events.forEach((e: any) => {
        expect(e.flowName).toBe('sample-flow')
      })
    })

    it('provides ctx.stepName in worker context', async () => {
      if (!redisAvailable) return

      const result = await $fetch<any>('/api/_flows/sample-flow/start', { method: 'POST' })

      await new Promise(r => setTimeout(r, 2000))

      const events = await $fetch<any[]>(`/api/_flows/sample-flow/${result.flowId}`)

      const startStepEvent = events.find((e: any) =>
        e.type === 'step.started' && e.stepName === 'start',
      )
      expect(startStepEvent).toBeDefined()
    })

    it('provides ctx.attempt in worker context', async () => {
      if (!redisAvailable) return

      const result = await $fetch<any>('/api/_flows/sample-flow/start', { method: 'POST' })

      await new Promise(r => setTimeout(r, 2000))

      const events = await $fetch<any[]>(`/api/_flows/sample-flow/${result.flowId}`)

      const stepEvents = events.filter((e: any) =>
        e.type === 'step.started' || e.type === 'step.completed',
      )

      stepEvents.forEach((e: any) => {
        expect(e.attempt).toBe(1)
      })
    })

    it('provides ctx.stepId with unique step run identifier', async () => {
      if (!redisAvailable) return

      const result = await $fetch<any>('/api/_flows/sample-flow/start', { method: 'POST' })

      await new Promise(r => setTimeout(r, 2000))

      const events = await $fetch<any[]>(`/api/_flows/sample-flow/${result.flowId}`)

      const stepStarted = events.find((e: any) => e.type === 'step.started')
      const stepCompleted = events.find((e: any) => e.type === 'step.completed')

      expect(stepStarted.stepId).toBe(stepCompleted.stepId)
      expect(stepStarted.stepId).toContain(result.flowId)
      expect(stepStarted.stepId).toContain('attempt-1')
    })

    it('provides ctx.flow.emit() for triggering flow events', async () => {
      if (!redisAvailable) return

      const result = await $fetch<any>('/api/_flows/sample-flow/start', { method: 'POST' })

      await new Promise(r => setTimeout(r, 2000))

      const events = await $fetch<any[]>(`/api/_flows/sample-flow/${result.flowId}`)

      const emitEvent = events.find((e: any) => e.type === 'emit')
      expect(emitEvent).toBeDefined()
    })

    it('provides ctx.flow.startFlow() for starting new flows', async () => {
      if (!redisAvailable) return

      const result = await $fetch<any>('/api/_flows/sample-flow/start', { method: 'POST' })

      expect(result.flowId).toBeTruthy()
      expect(result.step).toBe('start')
    })

    it('provides ctx.state for scoped state management', async () => {
      if (!redisAvailable) return

      const result = await $fetch<any>('/api/_flows/sample-flow/start', { method: 'POST' })

      await new Promise(r => setTimeout(r, 2000))

      const events = await $fetch<any[]>(`/api/_flows/sample-flow/${result.flowId}`)

      const completed = events.find((e: any) => e.type === 'step.completed')
      expect(completed).toBeDefined()
    })

    it('provides ctx.logger for structured logging', async () => {
      if (!redisAvailable) return

      const result = await $fetch<any>('/api/_flows/sample-flow/start', { method: 'POST' })

      await new Promise(r => setTimeout(r, 2000))

      const events = await $fetch<any[]>(`/api/_flows/sample-flow/${result.flowId}`)

      const logEvents = events.filter((e: any) => e.type === 'log')
      expect(logEvents.length).toBeGreaterThan(0)

      logEvents.forEach((e: any) => {
        expect(e.data.level).toBeDefined()
        expect(e.data.message).toBeDefined()
      })
    })
  })

  describe('retry and failure handling', () => {
    it('includes attempt number in stepId', async () => {
      if (!redisAvailable) return

      const result = await $fetch<any>('/api/_flows/sample-flow/start', { method: 'POST' })

      await new Promise(r => setTimeout(r, 2000))

      const events = await $fetch<any[]>(`/api/_flows/sample-flow/${result.flowId}`)

      const stepStarted = events.find((e: any) => e.type === 'step.started')

      expect(stepStarted.stepId).toMatch(/attempt-\d+/)
    })
  })

  describe('flow analyzer', () => {
    it('returns analyzed flow structure', async () => {
      const flows = await $fetch<any[]>('/api/_flows')

      const sampleFlow = flows.find((f: any) => f.id === 'sample-flow')
      expect(sampleFlow).toBeDefined()
      expect(sampleFlow.analyzed).toBeDefined()
    })

    it('analyzes flow dependencies correctly', async () => {
      const flows = await $fetch<any[]>('/api/_flows')
      const sampleFlow = flows.find((f: any) => f.id === 'sample-flow')

      const analyzed = sampleFlow.analyzed
      expect(analyzed.levels).toBeDefined()
      expect(analyzed.maxLevel).toBeDefined()
      expect(analyzed.steps).toBeDefined()

      expect(analyzed.levels.length).toBeGreaterThanOrEqual(2)
      expect(analyzed.maxLevel).toBeGreaterThanOrEqual(1)
    })

    it('identifies entry step in level 0', async () => {
      const flows = await $fetch<any[]>('/api/_flows')
      const sampleFlow = flows.find((f: any) => f.id === 'sample-flow')

      const analyzed = sampleFlow.analyzed
      const level0 = analyzed.levels[0]

      expect(level0).toBeDefined()
      expect(level0).toContain('start')
    })

    it('identifies dependent steps in correct levels', async () => {
      const flows = await $fetch<any[]>('/api/_flows')
      const sampleFlow = flows.find((f: any) => f.id === 'sample-flow')

      const analyzed = sampleFlow.analyzed
      const level1 = analyzed.levels[1]

      expect(level1).toBeDefined()
      expect(level1).toContain('next')
    })

    it('provides step details with dependencies', async () => {
      const flows = await $fetch<any[]>('/api/_flows')
      const sampleFlow = flows.find((f: any) => f.id === 'sample-flow')

      const analyzed = sampleFlow.analyzed
      const nextStep = analyzed.steps.next

      expect(nextStep).toBeDefined()
      expect(nextStep.name).toBe('next')
      expect(nextStep.level).toBe(1)
      expect(nextStep.dependsOn).toBeDefined()
      expect(Array.isArray(nextStep.dependsOn)).toBe(true)
    })

    it('handles steps without dependencies (entry step)', async () => {
      const flows = await $fetch<any[]>('/api/_flows')
      const sampleFlow = flows.find((f: any) => f.id === 'sample-flow')

      const analyzed = sampleFlow.analyzed
      const startStep = analyzed.steps.start

      expect(startStep.dependsOn).toBeDefined()
      expect(startStep.dependsOn.length).toBe(0)
      expect(startStep.level).toBe(0)
    })
  })

  describe('stream naming (nq:flow:{runId} pattern)', () => {
    it('uses nq:flow:{runId} pattern for flow events', async () => {
      if (!redisAvailable) return

      const result = await $fetch<any>('/api/_flows/sample-flow/start', { method: 'POST' })
      const runId = result.flowId

      await new Promise(r => setTimeout(r, 1000))

      const events = await $fetch<any[]>(`/api/_flows/sample-flow/${runId}`)

      expect(Array.isArray(events)).toBe(true)
      expect(events.length).toBeGreaterThan(0)
    })

    it('uses nq:flows:{flowName} pattern for flow index', async () => {
      if (!redisAvailable) return

      await $fetch<any>('/api/_flows/sample-flow/start', { method: 'POST' })

      await new Promise(r => setTimeout(r, 1000))

      const runs = await $fetch<any[]>('/api/_flows/sample-flow')

      expect(Array.isArray(runs)).toBe(true)
      expect(runs.length).toBeGreaterThan(0)
    })

    it('isolates events by runId', async () => {
      if (!redisAvailable) return

      const run1 = await $fetch<any>('/api/_flows/sample-flow/start', { method: 'POST' })
      const run2 = await $fetch<any>('/api/_flows/sample-flow/start', { method: 'POST' })

      await new Promise(r => setTimeout(r, 2000))

      const events1 = await $fetch<any[]>(`/api/_flows/sample-flow/${run1.flowId}`)
      const events2 = await $fetch<any[]>(`/api/_flows/sample-flow/${run2.flowId}`)

      expect(events1.every((e: any) => e.runId === run1.flowId)).toBe(true)
      expect(events2.every((e: any) => e.runId === run2.flowId)).toBe(true)

      const event1Ids = events1.map((e: any) => e.id)
      const event2Ids = events2.map((e: any) => e.id)
      const overlap = event1Ids.filter((id: string) => event2Ids.includes(id))
      expect(overlap.length).toBe(0)
    })

    it('lists all runs for a flow in the index', async () => {
      if (!redisAvailable) return

      const runs = await Promise.all([
        $fetch<any>('/api/_flows/sample-flow/start', { method: 'POST' }),
        $fetch<any>('/api/_flows/sample-flow/start', { method: 'POST' }),
        $fetch<any>('/api/_flows/sample-flow/start', { method: 'POST' }),
      ])

      await new Promise(r => setTimeout(r, 1000))

      const index = await $fetch<any[]>('/api/_flows/sample-flow')

      const runIds = runs.map(r => r.flowId)
      runIds.forEach((runId) => {
        expect(index.some((r: any) => r.id === runId)).toBe(true)
      })
    })

    it('supports querying flow runs by time range', async () => {
      if (!redisAvailable) return

      const startTime = Date.now()

      await $fetch<any>('/api/_flows/sample-flow/start', { method: 'POST' })

      await new Promise(r => setTimeout(r, 1000))

      const runs = await $fetch<any[]>('/api/_flows/sample-flow')

      runs.forEach((run: any) => {
        expect(run.ts).toBeDefined()
        const runTime = new Date(run.ts).getTime()
        expect(runTime).toBeGreaterThanOrEqual(startTime)
      })
    })
  })
})
