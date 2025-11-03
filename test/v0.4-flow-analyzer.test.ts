import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'

describe('v0.4 flow analyzer', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('./fixtures/flows', import.meta.url)),
  })

  it('should return analyzed flow structure', async () => {
    const flows = await $fetch<any[]>('/api/_flows')

    const sampleFlow = flows.find((f: any) => f.id === 'sample-flow')
    expect(sampleFlow).toBeDefined()
    expect(sampleFlow.analyzed).toBeDefined()
  })

  it('should analyze flow dependencies correctly', async () => {
    const flows = await $fetch<any[]>('/api/_flows')
    const sampleFlow = flows.find((f: any) => f.id === 'sample-flow')

    const analyzed = sampleFlow.analyzed
    expect(analyzed.levels).toBeDefined()
    expect(analyzed.maxLevel).toBeDefined()
    expect(analyzed.steps).toBeDefined()

    // Should have at least 2 levels (entry + next step)
    expect(analyzed.levels.length).toBeGreaterThanOrEqual(2)
    expect(analyzed.maxLevel).toBeGreaterThanOrEqual(1)
  })

  it('should identify entry step in level 0', async () => {
    const flows = await $fetch<any[]>('/api/_flows')
    const sampleFlow = flows.find((f: any) => f.id === 'sample-flow')

    const analyzed = sampleFlow.analyzed
    const level0 = analyzed.levels[0]

    expect(level0).toBeDefined()
    expect(level0).toContain('start')
  })

  it('should identify dependent steps in correct levels', async () => {
    const flows = await $fetch<any[]>('/api/_flows')
    const sampleFlow = flows.find((f: any) => f.id === 'sample-flow')

    const analyzed = sampleFlow.analyzed

    // 'next' step should be in level 1 (depends on 'start')
    const level1 = analyzed.levels[1]
    expect(level1).toBeDefined()
    expect(level1).toContain('next')
  })

  it('should provide step details with dependencies', async () => {
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

  it('should parse subscription tokens correctly', async () => {
    const flows = await $fetch<any[]>('/api/_flows')
    const sampleFlow = flows.find((f: any) => f.id === 'sample-flow')

    const analyzed = sampleFlow.analyzed
    const nextStep = analyzed.steps.next

    // 'next' subscribes to 'start' (implicit step:start token)
    expect(nextStep.dependsOn).toContain('start')
  })

  it('should identify triggers for each step', async () => {
    const flows = await $fetch<any[]>('/api/_flows')
    const sampleFlow = flows.find((f: any) => f.id === 'sample-flow')

    const analyzed = sampleFlow.analyzed
    const startStep = analyzed.steps.start

    expect(startStep.triggers).toBeDefined()
    expect(Array.isArray(startStep.triggers)).toBe(true)
  })

  it('should handle steps without dependencies (entry step)', async () => {
    const flows = await $fetch<any[]>('/api/_flows')
    const sampleFlow = flows.find((f: any) => f.id === 'sample-flow')

    const analyzed = sampleFlow.analyzed
    const startStep = analyzed.steps.start

    expect(startStep.dependsOn).toBeDefined()
    expect(startStep.dependsOn.length).toBe(0)
    expect(startStep.level).toBe(0)
  })
})
