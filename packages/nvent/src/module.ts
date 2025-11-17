import { join } from 'node:path'
import {
  defineNuxtModule,
  createResolver,
  addServerScanDir,
  addServerImports,
  addTemplate,
  updateTemplates,
} from '@nuxt/kit'
import defu from 'defu'
import { compileRegistryFromServerWorkers, type LayerInfo } from './registry'
import { watchQueueFiles } from './utils/dev'
import { generateRegistryTemplate, generateHandlersTemplate, generateAnalyzedFlowsTemplate } from './utils/templates'
import { normalizeModuleOptions, toRuntimeConfig, getRedisStorageConfig } from './runtime/config'
import type { ModuleOptions, ModuleConfig } from './runtime/config/types'
import type {} from '@nuxt/schema'

const meta = {
  name: 'queue',
  version: '0.1',
  configKey: 'queue',
}

declare module '@nuxt/schema' {
  interface RuntimeConfig {
    nvent: ModuleConfig
  }
}

export default defineNuxtModule<ModuleOptions>({
  meta,
  defaults: {},
  moduleDependencies: {
    'json-editor-vue/nuxt': {
      version: '0.18.1',
    },
  },
  async setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url)

    // Normalize and merge configuration
    const config = normalizeModuleOptions(options)

    // Use addServerScanDir only for api/ and plugins/ directories
    // These follow Nuxt conventions and won't include .d.ts files in the build
    addServerScanDir(resolve('./runtime/server'))

    nuxt.hook('nitro:config', (nitro) => {
      // Ensure Redis storage is configured for unstorage so StateProvider persists to Redis.
      const redisConfig = getRedisStorageConfig(config)
      nitro.storage = defu(nitro.storage || {}, {
        redis: {
          driver: 'redis',
          ...redisConfig,
          // base namespace handled in provider; keep storage base default
        },
      })
      nitro.experimental = defu(nitro.experimental || {}, {
        websocket: true,
      })
    })

    const runtimeConfig = nuxt.options.runtimeConfig

    // Convert normalized config to runtime config format
    runtimeConfig.nvent = defu(runtimeConfig.nvent || {}, toRuntimeConfig(config)) as any

    // Add rootDir to runtime config for file-based adapters
    if (!runtimeConfig.nvent) runtimeConfig.nvent = {} as any
    ;(runtimeConfig.nvent as any).rootDir = nuxt.options.rootDir

    // Build real registry snapshot from disk
    const layerInfos: LayerInfo[] = nuxt.options._layers.map(l => ({
      rootDir: l.config.rootDir,
      serverDir: l.config?.serverDir || join(l.config.rootDir, 'server'),
    }))

    // Prepare default configs from normalized config
    // Extract worker config separately, pass rest as queue config
    const { worker, ...queueOptions } = config.queue
    const defaultConfigs = {
      queue: queueOptions,
      worker,
    }

    const compiledRegistry = await compileRegistryFromServerWorkers(layerInfos, config.dir || 'queues', defaultConfigs)
    // augment with defaults and metadata
    const compiledWithMeta = defu(compiledRegistry, {
      version: 1,
      compiledAt: new Date().toISOString(),
      provider: { name: config.queue.adapter === 'postgres' ? 'pgboss' : 'bullmq' },
      logger: { name: 'console', level: 'info' },
      state: config.state,
      eventStore: config.eventStore,
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
    const REGISTRY_TEMPLATE = 'queue-registry.mjs'
    const HANDLERS_TEMPLATE = 'worker-handlers.mjs'
    const ANALYZED_FLOWS_TEMPLATE = 'analyzed-flows.mjs'

    // add dynamic ts files to build transpile list
    for (const templateName of [REGISTRY_TEMPLATE, HANDLERS_TEMPLATE, ANALYZED_FLOWS_TEMPLATE] as const) {
      const templatePath = resolve(nuxt.options.buildDir, templateName)
      nuxt.options.build.transpile.push(templatePath)
    }

    // Emit a template so changes trigger HMR/rebuilds even if only runtimeConfig changes
    addTemplate({
      filename: REGISTRY_TEMPLATE,
      write: true,
      getContents: () => generateRegistryTemplate(lastCompiledRegistry),
    })

    addTemplate({
      filename: HANDLERS_TEMPLATE,
      write: true,
      getContents: () => generateHandlersTemplate(lastCompiledRegistry),
    })

    addTemplate({
      filename: ANALYZED_FLOWS_TEMPLATE,
      write: true,
      getContents: () => generateAnalyzedFlowsTemplate(lastCompiledRegistry),
    })

    // add composables
    addServerImports([
      // Generated templates
      {
        name: 'useQueueRegistry',
        as: '$useQueueRegistry',
        from: resolve(nuxt.options.buildDir, 'queue-registry'),
      },
      {
        name: 'useWorkerHandlers',
        as: '$useWorkerHandlers',
        from: resolve(nuxt.options.buildDir, 'worker-handlers'),
      },
      {
        name: 'useAnalyzedFlows',
        as: '$useAnalyzedFlows',
        from: resolve(nuxt.options.buildDir, 'analyzed-flows'),
      },
      // Core utilities for user code
      {
        name: 'defineQueueConfig',
        from: resolve('./runtime/utils/defineQueueConfig'),
      },
      {
        name: 'defineQueueWorker',
        from: resolve('./runtime/utils/defineQueueWorker'),
      },
      // Composables users may need in server code
      {
        name: 'useFlowEngine',
        from: resolve('./runtime/utils/useFlowEngine'),
      },
      {
        name: 'useEventManager',
        from: resolve('./runtime/utils/useEventManager'),
      },
      {
        name: 'usePeerManager',
        from: resolve('./runtime/utils/wsPeerManager'),
      },
      {
        name: 'useNventLogger',
        from: resolve('./runtime/utils/useNventLogger'),
      }, {
        name: 'useQueueAdapter',
        from: resolve('./runtime/utils/adapters'),
      }, {
        name: 'useStoreAdapter',
        from: resolve('./runtime/utils/adapters'),
      }, {
        name: 'useStreamAdapter',
        from: resolve('./runtime/utils/adapters'),
      }, {
        name: 'useStateAdapter',
        from: resolve('./runtime/utils/adapters'),
      },
      {
        name: 'getAdapters',
        from: resolve('./runtime/utils/adapters'),
      }, {
        name: 'setAdapters',
        from: resolve('./runtime/utils/adapters'),
      }, {
        name: 'useStreamTopics',
        from: resolve('./runtime/utils/useStreamTopics'),
      },
    ])

    // Small helper to refresh registry and re-generate app (dev)
    const refreshRegistry = async (reason: string, changedPath?: string) => {
      const queuesRel = config.dir || 'queues'
      const updatedRegistry = await compileRegistryFromServerWorkers(layerInfos, queuesRel, defaultConfigs)
      // No merging: the compiled registry is the single source of truth
      lastCompiledRegistry = JSON.parse(JSON.stringify(defu(updatedRegistry, {
        version: 1,
        compiledAt: new Date().toISOString(),
        provider: { name: config.queue.adapter === 'postgres' ? 'pgboss' : 'bullmq' },
        logger: { name: 'console', level: 'info' },
        state: config.state,
        eventStore: config.eventStore,
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
      const queuesRel = config.dir || 'queues'

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

export type { ModuleOptions } from './runtime/config/types'
