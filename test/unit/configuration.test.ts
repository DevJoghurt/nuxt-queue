import { describe, it, expect } from 'vitest'
import { normalizeModuleOptions, toRuntimeConfig } from '../../packages/nvent/src/runtime/config'

describe('configuration system', () => {
  describe('normalizeModuleOptions', () => {
    it('provides default configuration', () => {
      const config = normalizeModuleOptions({})

      expect(config.dir).toBeDefined()
      expect(config.queue).toBeDefined()
      expect(config.store).toBeDefined()
      expect(config.stream).toBeDefined()
      expect(config.flows).toBeDefined()
    })

    it('uses memory adapter as default for queue', () => {
      const config = normalizeModuleOptions({})

      expect(config.queue.adapter).toBe('file')
    })

    it('uses memory adapter as default for store', () => {
      const config = normalizeModuleOptions({})

      expect(config.store.adapter).toBe('file')
    })

    it('uses memory adapter as default for stream', () => {
      const config = normalizeModuleOptions({})

      expect(config.stream.adapter).toBe('memory')
    })

    it('overrides defaults with user options', () => {
      const config = normalizeModuleOptions({
        queue: {
          adapter: 'memory',
          worker: {
            concurrency: 5,
          },
        },
      })

      expect(config.queue.adapter).toBe('memory')
      expect(config.queue.worker.concurrency).toBe(5)
    })

    it('merges queue configuration deeply', () => {
      const config = normalizeModuleOptions({
        queue: {
          prefix: 'test',
          worker: {
            concurrency: 3,
          },
        },
      })

      expect(config.queue.prefix).toBe('test')
      expect(config.queue.worker.concurrency).toBe(3)
      expect(config.queue.worker.autorun).toBeDefined()
    })

    it('handles connections configuration', () => {
      const config = normalizeModuleOptions({
        connections: {
          redis: {
            host: 'localhost',
            port: 6379,
          },
        },
      })

      expect(config.connections.redis).toBeDefined()
      expect(config.connections.redis.host).toBe('localhost')
      expect(config.connections.redis.port).toBe(6379)
    })

    it('supports adapter-specific connection overrides', () => {
      const config = normalizeModuleOptions({
        connections: {
          redis: {
            host: 'shared.redis',
            port: 6379,
          },
        },
        queue: {
          adapter: 'redis',
          redis: {
            host: 'queue.redis',
            port: 6380,
          },
        },
      })

      expect(config.queue.redis).toBeDefined()
      expect(config.queue.redis.host).toBe('queue.redis')
      expect(config.queue.redis.port).toBe(6380)
    })

    it('configures worker options', () => {
      const config = normalizeModuleOptions({
        queue: {
          worker: {
            concurrency: 4,
            autorun: false,
            lockDurationMs: 60000,
          },
        },
      })

      expect(config.queue.worker.concurrency).toBe(4)
      expect(config.queue.worker.autorun).toBe(false)
      expect(config.queue.worker.lockDurationMs).toBe(60000)
    })

    it('configures flow options', () => {
      const config = normalizeModuleOptions({
        flows: {
          stallDetection: {
            enabled: true,
            stallTimeout: 60000,
            checkInterval: 30000,
          },
        },
      })

      expect(config.flows.stallDetection).toBeDefined()
      expect(config.flows.stallDetection.enabled).toBe(true)
      expect(config.flows.stallDetection.stallTimeout).toBe(60000)
    })

    it('configures state management', () => {
      const config = normalizeModuleOptions({
        store: {
          state: {
            autoScope: 'flow',
            cleanup: {
              strategy: 'on-complete',
              ttlMs: 3600000,
            },
          },
        },
      })

      expect(config.store.state).toBeDefined()
      expect(config.store.state.autoScope).toBe('flow')
      expect(config.store.state.cleanup.strategy).toBe('on-complete')
    })

    it('handles file adapter configuration', () => {
      const config = normalizeModuleOptions({
        queue: {
          adapter: 'file',
          file: {
            dataDir: '.custom-data',
          },
        },
      })

      expect(config.queue.adapter).toBe('file')
      expect(config.queue.file).toBeDefined()
      expect(config.queue.file.dataDir).toBe('.custom-data')
    })
  })

  describe('toRuntimeConfig', () => {
    it('converts module options to runtime config format', () => {
      const moduleOptions = normalizeModuleOptions({
        queue: {
          adapter: 'memory',
          worker: {
            concurrency: 3,
          },
        },
      })

      const runtimeConfig = toRuntimeConfig(moduleOptions)

      expect(runtimeConfig.queue).toBeDefined()
      expect(runtimeConfig.queue.adapter).toBe('memory')
      expect(runtimeConfig.queue.worker.concurrency).toBe(3)
    })

    it('includes all adapter configurations', () => {
      const moduleOptions = normalizeModuleOptions({
        queue: { adapter: 'memory' },
        store: { adapter: 'memory' },
        stream: { adapter: 'memory' },
      })

      const runtimeConfig = toRuntimeConfig(moduleOptions)

      expect(runtimeConfig.queue.adapter).toBe('memory')
      expect(runtimeConfig.store.adapter).toBe('memory')
      expect(runtimeConfig.stream.adapter).toBe('memory')
    })

    it('preserves connection configurations', () => {
      const moduleOptions = normalizeModuleOptions({
        connections: {
          redis: {
            host: 'localhost',
            port: 6379,
          },
        },
      })

      const runtimeConfig = toRuntimeConfig(moduleOptions)

      expect(runtimeConfig.connections.redis).toBeDefined()
      expect(runtimeConfig.connections.redis.host).toBe('localhost')
    })

    it('includes flow configuration', () => {
      const moduleOptions = normalizeModuleOptions({
        flows: {
          stallDetection: {
            enabled: true,
            stallTimeout: 60000,
          },
        },
      })

      const runtimeConfig = toRuntimeConfig(moduleOptions)

      expect(runtimeConfig.flows.stallDetection).toBeDefined()
      expect(runtimeConfig.flows.stallDetection.enabled).toBe(true)
    })
  })

  describe('adapter configuration validation', () => {
    it('accepts valid memory adapter config', () => {
      const config = normalizeModuleOptions({
        queue: { adapter: 'memory' },
        store: { adapter: 'memory' },
        stream: { adapter: 'memory' },
      })

      expect(config.queue.adapter).toBe('memory')
      expect(config.store.adapter).toBe('memory')
      expect(config.stream.adapter).toBe('memory')
    })

    it('accepts valid file adapter config', () => {
      const config = normalizeModuleOptions({
        queue: {
          adapter: 'file',
          file: { dataDir: '.data' },
        },
        store: {
          adapter: 'file',
          file: { dataDir: '.data' },
        },
      })

      expect(config.queue.adapter).toBe('file')
      expect(config.store.adapter).toBe('file')
    })

    it('accepts valid redis adapter config', () => {
      const config = normalizeModuleOptions({
        queue: {
          adapter: 'redis',
          redis: {
            host: 'localhost',
            port: 6379,
          },
        },
      })

      expect(config.queue.adapter).toBe('redis')
      expect(config.queue.redis).toBeDefined()
    })

    it('accepts valid postgres adapter config', () => {
      const config = normalizeModuleOptions({
        queue: {
          adapter: 'postgres',
          postgres: {
            host: 'localhost',
            port: 5432,
            database: 'test',
          },
        },
      })

      expect(config.queue.adapter).toBe('postgres')
      expect(config.queue.postgres).toBeDefined()
    })
  })

  describe('configuration defaults', () => {
    it('provides sensible queue defaults', () => {
      const config = normalizeModuleOptions({})

      expect(config.queue.worker.concurrency).toBeGreaterThan(0)
      expect(config.queue.worker.autorun).toBeDefined()
      expect(typeof config.queue.worker.autorun).toBe('boolean')
    })

    it('provides sensible store defaults', () => {
      const config = normalizeModuleOptions({})

      expect(config.store.prefix).toBeDefined()
      expect(config.store.state).toBeDefined()
      expect(config.store.state.autoScope).toBeDefined()
    })

    it('provides sensible flow defaults', () => {
      const config = normalizeModuleOptions({})

      expect(config.flows.stallDetection).toBeDefined()
      expect(config.flows.stallDetection.enabled).toBeDefined()
    })
  })
})
