import { join } from 'node:path'
import {
  defineNuxtModule,
  createResolver,
  addServerScanDir,
  addServerImports,
  addTemplate,
  addImportsDir,
  addComponent,
  addComponentsDir,
  addPlugin,
  updateTemplates,
} from '@nuxt/kit'
import defu from 'defu'
import { compileRegistryFromServerWorkers, type LayerInfo } from './registry'
import { watchQueueFiles } from './utils/dev'
import { generateRegistryTemplate, generateHandlersTemplate, generateAnalyzedFlowsTemplate } from './utils/templates'
import type {} from '@nuxt/schema'

const meta = {
  name: 'queue',
  version: '0.1',
  configKey: 'queue',
}

export interface ModuleOptions {
  dir?: string
  runtimeDir?: string
  ui?: boolean
  redis?: {
    host?: string
    port?: number
    username?: string
    password?: string
    db?: number
    url?: string
  }
  debug?: Record<string, any>
  /**
   * Default queue configuration applied to all queues.
   * Can be overridden per-queue using defineQueueConfig.
   */
  defaultQueueConfig?: {
    /**
     * Default job options for all queues.
     */
    defaultJobOptions?: {
      attempts?: number
      backoff?: number | { type: 'fixed' | 'exponential', delay: number }
      delay?: number
      priority?: number
      timeout?: number
      lifo?: boolean
      removeOnComplete?: boolean | number
      removeOnFail?: boolean | number
    }
    /**
     * Rate limiting configuration.
     */
    limiter?: {
      max?: number
      duration?: number
      groupKey?: string
    }
    /**
     * Prefix for queue keys.
     */
    prefix?: string
  }
  /**
   * Default worker configuration applied to all workers.
   * Can be overridden per-worker using defineQueueConfig.
   */
  defaultWorkerConfig?: {
    concurrency?: number
    lockDurationMs?: number
    maxStalledCount?: number
    drainDelayMs?: number
    autorun?: boolean
    pollingIntervalMs?: number
  }
}

declare module '@nuxt/schema' {
  interface RuntimeConfig {
    queue: {
      runtimeDir: string
      redis: ModuleOptions['redis']
      queues: any
      workers: any
      // compiled registry snapshot (JSON-safe)
      registry?: any
      state?: {
        name?: 'redis' | 'postgres'
        namespace?: string
        autoScope?: 'always' | 'flow' | 'never'
        cleanup?: {
          strategy?: 'never' | 'immediate' | 'ttl' | 'on-complete'
          ttlMs?: number
        }
      }
      eventStore?: {
        name?: 'redis' | 'postgres' | 'memory' | 'file'
        mode?: 'streams' | 'fallback'
        streams?: any
        options?: {
          file?: {
            dir?: string
            ext?: string
            pollMs?: number
          }
        }
      }
      // Default queue configuration from nuxt.config
      defaultQueueConfig?: ModuleOptions['defaultQueueConfig']
      // Default worker configuration from nuxt.config
      defaultWorkerConfig?: ModuleOptions['defaultWorkerConfig']
    }
  }
}

export default defineNuxtModule<ModuleOptions>({
  meta,
  defaults: {
    dir: 'queues',
    runtimeDir: '',
    ui: true,
    debug: {},
    redis: {
      host: '127.0.0.1',
      port: 6379,
    },
  },
  moduleDependencies: {
    'json-editor-vue/nuxt': {
      version: '0.18.1',
    },
  },
  async setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url)

    addServerScanDir(resolve('./runtime/server'))

    // Add shared utilities for both app and server
    addImportsDir(resolve('./runtime/shared/utils'))

    addImportsDir(resolve('./runtime/app/composables'))

    // add vueflow assets

    if (options.ui) {
      addPlugin({
        src: resolve('./runtime/app/plugins/vueflow.client.ts'),
        mode: 'client',
      })
      addComponentsDir({
        path: resolve('./runtime/app/components'),
        prefix: 'Queue',
      })

      addComponent({
        name: 'QueueApp',
        filePath: resolve('./runtime/app/pages/index.vue'),
        global: true,
      })
    }

    // add jsoneditor to vite optimize -> for esm support
    nuxt.options.vite.optimizeDeps = defu(nuxt.options.vite.optimizeDeps, {
      include: ['vanilla-jsoneditor'],
    })

    nuxt.hook('nitro:config', (nitro) => {
      // Ensure Redis storage is configured for unstorage so StateProvider persists to Redis.
      nitro.storage = defu(nitro.storage || {}, {
        redis: {
          driver: 'redis',
          host: options.redis?.host,
          port: options.redis?.port,
          username: options.redis?.username,
          password: options.redis?.password,
          // base namespace handled in provider; keep storage base default
        },
      })
      nitro.experimental = defu(nitro.experimental || {}, {
        websocket: true,
      })
    })

    const runtimeConfig = nuxt.options.runtimeConfig

    runtimeConfig.queue = defu(runtimeConfig.queue || {}, {
      redis: options.redis,
      debug: options.debug || {},
      workers: [],
      state: { name: 'redis', namespace: 'nq', autoScope: 'always', cleanup: { strategy: 'never' } },
      eventStore: { name: 'redis' },
      defaultQueueConfig: options.defaultQueueConfig || {},
      defaultWorkerConfig: options.defaultWorkerConfig || {},
    }) as any

    // Build real registry snapshot from disk
    const layerInfos: LayerInfo[] = nuxt.options._layers.map(l => ({
      rootDir: l.config.rootDir,
      serverDir: l.config?.serverDir || join(l.config.rootDir, 'server'),
    }))

    // Prepare default configs from module options
    const defaultConfigs = {
      queue: options.defaultQueueConfig,
      worker: options.defaultWorkerConfig,
    }

    const compiledRegistry = await compileRegistryFromServerWorkers(layerInfos, options?.dir || 'queues', defaultConfigs)
    // augment with defaults and metadata
    const compiledWithMeta = defu(compiledRegistry, {
      version: 1,
      compiledAt: new Date().toISOString(),
      provider: { name: 'bullmq' },
      logger: { name: 'console', level: 'info' },
      state: { name: 'redis', namespace: 'nq', autoScope: 'always', cleanup: { strategy: 'never' } },
      eventStore: { name: 'redis' },
      runner: { ts: { isolate: 'inprocess' }, py: { enabled: false, cmd: 'python3', importMode: 'file' } },
      workers: [],
      flows: {},
      eventIndex: {},
    })
    // Ensure plain JSON snapshot to avoid readonly/proxy issues in Nitro normalization
    const compiledSnapshot = JSON.parse(JSON.stringify(compiledWithMeta))
    // Keep a mutable reference for dev updates
    let lastCompiledRegistry = compiledSnapshot

    // Template filenames for reference
    const REGISTRY_TEMPLATE = 'queue-registry.ts'
    const HANDLERS_TEMPLATE = 'worker-handlers.ts'
    const ANALYZED_FLOWS_TEMPLATE = 'analyzed-flows.ts'

    // Emit a template so changes trigger HMR/rebuilds even if only runtimeConfig changes
    addTemplate({
      filename: REGISTRY_TEMPLATE,
      write: true,
      getContents: () => generateRegistryTemplate(lastCompiledRegistry),
    })

    // Template: bundle worker handlers into Nitro context so imports work at runtime
    addTemplate({
      filename: HANDLERS_TEMPLATE,
      write: true,
      getContents: () => generateHandlersTemplate(lastCompiledRegistry),
    })

    // Template: pre-analyze flows at build time
    addTemplate({
      filename: ANALYZED_FLOWS_TEMPLATE,
      write: true,
      getContents: () => generateAnalyzedFlowsTemplate(lastCompiledRegistry),
    })

    // add composables
    addServerImports([{
      name: 'useQueueRegistry',
      as: '$useQueueRegistry',
      from: resolve(nuxt.options.buildDir, 'queue-registry'),
    }, {
      name: 'useWorkerHandlers',
      as: '$useWorkerHandlers',
      from: resolve(nuxt.options.buildDir, 'worker-handlers'),
    }, {
      name: 'useAnalyzedFlows',
      as: '$useAnalyzedFlows',
      from: resolve(nuxt.options.buildDir, 'analyzed-flows'),
    }])

    // Small helper to refresh registry and re-generate app (dev)
    const refreshRegistry = async (reason: string, changedPath?: string) => {
      const queuesRel = options?.dir || 'queues'
      const updatedRegistry = await compileRegistryFromServerWorkers(layerInfos, queuesRel, defaultConfigs)
      // No merging: the compiled registry is the single source of truth
      lastCompiledRegistry = JSON.parse(JSON.stringify(defu(updatedRegistry, {
        version: 1,
        compiledAt: new Date().toISOString(),
        provider: { name: 'bullmq' },
        logger: { name: 'console', level: 'info' },
        state: { name: 'redis', namespace: 'nq' },
        eventStore: { name: 'redis' },
        runner: { ts: { isolate: 'inprocess' }, py: { enabled: false, cmd: 'python3', importMode: 'file' } },
        workers: [],
        flows: {},
        eventIndex: {},
      })))

      console.log(`[nuxt-queue] registry refreshed (${reason})`, changedPath || '')
      console.log(`[nuxt-queue] new registry has ${lastCompiledRegistry.workers?.length || 0} workers`)
      console.log(`[nuxt-queue] new registry compiled at: ${lastCompiledRegistry.compiledAt}`)

      // Update templates to trigger regeneration
      await updateTemplates({
        filter: (template) => {
          const match = template.filename === REGISTRY_TEMPLATE
            || template.filename === HANDLERS_TEMPLATE
            || template.filename === ANALYZED_FLOWS_TEMPLATE
          if (match) {
            console.log(`[nuxt-queue] updating template: ${template.filename}`)
          }
          return match
        },
      })

      console.log(`[nuxt-queue] templates updated`)
    }

    if (nuxt.options.dev) {
      // Watch for changes in queue files and rebuild registry
      const queuesRel = options?.dir || 'queues'

      // Use chokidar-based watcher for reliable file watching
      // Vite HMR handles component updates automatically when templates change
      watchQueueFiles({
        nuxt,
        layerInfos,
        queuesDir: queuesRel,
        onRefresh: refreshRegistry,
      })
    }
  },
})
