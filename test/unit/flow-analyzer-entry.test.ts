import { describe, it, expect } from 'vitest'
import { analyzeFlow } from '../../packages/nvent/src/registry/flowAnalyzer'

describe('Flow Analyzer - Entry Step Handling', () => {
  it('should include entry step with awaitAfter in analysis', () => {
    const flow = {
      id: 'test-flow',
      entry: {
        step: 'test-step',
        queue: 'test-queue',
        workerId: 'w1',
        emits: ['entry.done'],
        awaitAfter: {
          type: 'time' as const,
          delay: 2000,
          timeout: 10000,
        },
      },
      steps: {
        'step-1': {
          queue: 'test-queue',
          workerId: 'w2',
          subscribes: ['entry.done'],
        },
      },
    }

    const analyzed = analyzeFlow(flow)

    // Entry step should be in analyzed steps
    expect(analyzed.steps['test-step']).toBeDefined()
    expect(analyzed.steps['test-step'].name).toBe('test-step')
    expect(analyzed.steps['test-step'].level).toBe(0)
    expect(analyzed.steps['test-step'].hasAwaitPattern).toBe(true)
    expect(analyzed.steps['test-step'].emits).toEqual(['entry.done'])
    expect(analyzed.steps['test-step'].awaitAfter).toBeDefined()

    // Entry step should be in level 0
    expect(analyzed.levels[0]).toContain('test-step')

    // Await patterns should include entry step
    expect(analyzed.awaitPatterns).toBeDefined()
    expect(analyzed.awaitPatterns?.steps).toContain('test-step')
    expect(analyzed.awaitPatterns?.afterCount).toBe(1)
  })

  it('should handle entry step emits correctly in findEmitter', () => {
    const flow = {
      id: 'test-flow',
      entry: {
        step: 'test-step',
        queue: 'test-queue',
        workerId: 'w1',
        emits: ['entry.done'],
        awaitAfter: {
          type: 'time' as const,
          delay: 2000,
          timeout: 10000,
        },
      },
      steps: {
        'step-1': {
          queue: 'test-queue',
          workerId: 'w2',
          subscribes: ['entry.done'],
        },
      },
    }

    const analyzed = analyzeFlow(flow)

    // step-1 should depend on test-step (entry)
    expect(analyzed.steps['step-1'].dependsOn).toEqual(['test-step'])
    expect(analyzed.steps['test-step'].triggers).toContain('step-1')
  })

  it('should handle sequential awaits (entry awaitAfter + step awaitBefore)', () => {
    const flow = {
      id: 'test-flow',
      entry: {
        step: 'test-step',
        queue: 'test-queue',
        workerId: 'w1',
        emits: ['entry.done'],
        awaitAfter: {
          type: 'time' as const,
          delay: 2000,
          timeout: 10000,
        },
      },
      steps: {
        'step-1': {
          queue: 'test-queue',
          workerId: 'w2',
          subscribes: ['entry.done'],
        },
        'step-2': {
          queue: 'test-queue',
          workerId: 'w3',
          subscribes: ['entry.done'],
          awaitBefore: {
            type: 'schedule' as const,
            cron: '*/1 * * * *',
            timeout: 120000,
          },
        },
      },
    }

    const analyzed = analyzeFlow(flow)

    // Both steps should depend on entry
    expect(analyzed.steps['step-1'].dependsOn).toEqual(['test-step'])
    expect(analyzed.steps['step-2'].dependsOn).toEqual(['test-step'])

    // Entry should trigger both steps
    expect(analyzed.steps['test-step'].triggers).toContain('step-1')
    expect(analyzed.steps['test-step'].triggers).toContain('step-2')

    // Await patterns should include both entry and step-2
    expect(analyzed.awaitPatterns?.steps).toContain('test-step')
    expect(analyzed.awaitPatterns?.steps).toContain('step-2')
    expect(analyzed.awaitPatterns?.beforeCount).toBe(1)
    expect(analyzed.awaitPatterns?.afterCount).toBe(1)
    expect(analyzed.awaitPatterns?.totalTimeout).toBe(130000) // 10000 + 120000
  })

  it('should handle entry step without awaits', () => {
    const flow = {
      id: 'test-flow',
      entry: {
        step: 'test-step',
        queue: 'test-queue',
        workerId: 'w1',
        emits: ['entry.done'],
      },
      steps: {
        'step-1': {
          queue: 'test-queue',
          workerId: 'w2',
          subscribes: ['entry.done'],
        },
      },
    }

    const analyzed = analyzeFlow(flow)

    // Entry step should still be included
    expect(analyzed.steps['test-step']).toBeDefined()
    expect(analyzed.steps['test-step'].hasAwaitPattern).toBe(false)
    expect(analyzed.levels[0]).toContain('test-step')
  })
})
