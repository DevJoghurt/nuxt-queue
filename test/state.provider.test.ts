import { describe, it, expect, vi } from 'vitest'

// Mock #imports for v0.4 state provider
vi.mock('#imports', () => {
  const mockStorage = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    getKeys: vi.fn(),
  }

  return {
    useRuntimeConfig: () => ({
      queue: {
        state: { name: 'redis', namespace: 'nq' },
      },
    }),
    useStorage: () => mockStorage,
  }
})

// Mock Redis client for testing
const mockRedisClient = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  keys: vi.fn(),
}

vi.mock('ioredis', () => {
  return {
    default: vi.fn(() => mockRedisClient),
  }
})

describe('v0.4 StateProvider', () => {
  it('exposes get/set/delete interface', async () => {
    const { getStateProvider } = await import('../src/runtime/server/state/stateFactory')
    const state = getStateProvider()

    expect(state).toBeDefined()
    expect(typeof state.get).toBe('function')
    expect(typeof state.set).toBe('function')
    expect(typeof state.delete).toBe('function')
    expect(typeof state.list).toBe('function')
  })
})
