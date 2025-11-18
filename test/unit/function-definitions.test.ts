import { describe, it, expect } from 'vitest'
import { defineFunctionConfig } from '../../packages/nvent/src/runtime/utils/defineFunctionConfig'

// Note: defineFunction tests are skipped as they require full Nuxt runtime with auto-imports
// These tests focus on defineFunctionConfig which is a simple type helper

describe('defineFunctionConfig', () => {
  it('returns the same config object', () => {
    const config = { queue: { name: 'test' } }
    const result = defineFunctionConfig(config)

    expect(result).toBe(config)
    expect(result).toEqual({ queue: { name: 'test' } })
  })

  it('accepts queue configuration', () => {
    const config = defineFunctionConfig({
      queue: {
        name: 'test-queue',
        prefix: 'nq',
        defaultJobOptions: {
          attempts: 3,
          delay: 1000,
        },
      },
    })

    expect(config.queue?.name).toBe('test-queue')
    expect(config.queue?.prefix).toBe('nq')
    expect(config.queue?.defaultJobOptions?.attempts).toBe(3)
    expect(config.queue?.defaultJobOptions?.delay).toBe(1000)
  })

  it('accepts flow configuration', () => {
    const config = defineFunctionConfig({
      queue: { name: 'flows' },
      flow: {
        name: 'my-flow',
        role: 'entry',
        step: 'start',
        emits: ['start.completed'],
      },
    })

    expect(config.flow?.name).toBe('my-flow')
    expect(config.flow?.role).toBe('entry')
    expect(config.flow?.step).toBe('start')
    expect(config.flow?.emits).toEqual(['start.completed'])
  })

  it('accepts worker configuration', () => {
    const config = defineFunctionConfig({
      queue: { name: 'test' },
      worker: {
        concurrency: 5,
        autorun: true,
        pollingIntervalMs: 1000,
      },
    })

    expect(config.worker?.concurrency).toBe(5)
    expect(config.worker?.autorun).toBe(true)
    expect(config.worker?.pollingIntervalMs).toBe(1000)
  })

  it('accepts flow step configuration', () => {
    const config = defineFunctionConfig({
      queue: { name: 'flows' },
      flow: {
        name: 'workflow',
        role: 'step',
        step: 'process',
        subscribes: ['start.completed'],
        emits: ['process.completed'],
      },
    })

    expect(config.flow?.role).toBe('step')
    expect(Array.isArray(config.flow?.subscribes) ? config.flow.subscribes : [config.flow?.subscribes]).toEqual(['start.completed'])
  })

  it('accepts multiple flow names', () => {
    const config = defineFunctionConfig({
      queue: { name: 'shared' },
      flow: {
        name: ['flow1', 'flow2'],
        role: 'step',
        step: 'shared-step',
      },
    })

    expect(config.flow?.name).toEqual(['flow1', 'flow2'])
  })

  it('accepts job default options', () => {
    const config = defineFunctionConfig({
      queue: {
        name: 'test',
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          priority: 5,
          timeout: 30000,
          removeOnComplete: true,
        },
      },
    })

    const opts = config.queue?.defaultJobOptions
    expect(opts?.attempts).toBe(3)
    expect(opts?.backoff).toEqual({ type: 'exponential', delay: 1000 })
    expect(opts?.priority).toBe(5)
    expect(opts?.timeout).toBe(30000)
    expect(opts?.removeOnComplete).toBe(true)
  })

  it('accepts rate limiter configuration', () => {
    const config = defineFunctionConfig({
      queue: {
        name: 'limited',
        limiter: {
          max: 10,
          duration: 60000,
          groupKey: 'user',
        },
      },
    })

    expect(config.queue?.limiter?.max).toBe(10)
    expect(config.queue?.limiter?.duration).toBe(60000)
    expect(config.queue?.limiter?.groupKey).toBe('user')
  })
})

describe.skip('defineFunction tests', () => {
  // These tests require full Nuxt runtime with auto-imports (#imports)
  // Testing defineFunction properly requires e2e tests with actual Nuxt app

  it.skip('placeholder for defineFunction tests', () => {})
})

describe('function definition pattern', () => {
  it('combines config and handler export', () => {
    // Simulate a typical function file
    const config = defineFunctionConfig({
      queue: { name: 'test' },
      flow: {
        name: 'test-flow',
        role: 'entry',
        step: 'start',
      },
    })

    // Verify config is properly typed
    expect(config.queue?.name).toBe('test')
    expect(config.flow?.step).toBe('start')
  })

  it('supports step functions with subscriptions', () => {
    const config = defineFunctionConfig({
      queue: { name: 'flows' },
      flow: {
        name: 'workflow',
        role: 'step',
        step: 'process',
        subscribes: ['start.completed'],
        emits: ['process.completed'],
      },
    })

    expect(config.flow?.role).toBe('step')
    expect(Array.isArray(config.flow?.subscribes) ? config.flow.subscribes : [config.flow?.subscribes]).toEqual(['start.completed'])
    expect(config.flow?.emits).toEqual(['process.completed'])
  })

  it('supports minimal configuration', () => {
    const config = defineFunctionConfig({
      queue: { name: 'simple' },
    })

    expect(config.queue?.name).toBe('simple')
    expect('flow' in config).toBe(false)
    expect('worker' in config).toBe(false)
  })

  it('supports array of event subscriptions', () => {
    const config = defineFunctionConfig({
      queue: { name: 'flows' },
      flow: {
        name: 'complex-flow',
        role: 'step',
        step: 'gather',
        subscribes: ['task-a.completed', 'task-b.completed'],
        emits: ['gather.completed'],
      },
    })

    expect(Array.isArray(config.flow?.subscribes)).toBe(true)
    expect(config.flow?.subscribes).toEqual(['task-a.completed', 'task-b.completed'])
  })
})
