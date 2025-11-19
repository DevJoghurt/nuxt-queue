import { join } from 'node:path'
import {
  defineNuxtModule,
  createResolver,
  addServerScanDir,
  addServerImports,
  addTemplate,
  addTypeTemplate,
  updateTemplates,
} from '@nuxt/kit'
import defu from 'defu'
import { compileRegistryFromServerWorkers, type LayerInfo } from './registry'
import { watchQueueFiles } from './utils/dev'
import { generateRegistryTemplate, generateHandlersTemplate, generateAnalyzedFlowsTemplate, generateTriggerRegistryTemplate } from './utils/templates'
import { normalizeModuleOptions, toRuntimeConfig, getRedisStorageConfig } from './runtime/config'
import type { ModuleOptions, ModuleConfig } from './runtime/config/types'
import type {} from '@nuxt/schema'

const meta = {
  name: 'nvent',
  version: '0.4.1',
  configKey: 'nvent',
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

    // In Nuxt 4, we need to merge both options parameter AND nuxt.options[configKey]
    const userConfig = (nuxt.options as any)[meta.configKey] || {}
    const mergedOptions = { ...userConfig, ...options }

    // Normalize and merge configuration
    const config = normalizeModuleOptions(mergedOptions)

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

    const compiledRegistry = await compileRegistryFromServerWorkers(layerInfos, config.dir || 'functions', defaultConfigs)
    // augment with defaults and metadata
    const compiledWithMeta = defu(compiledRegistry, {
      version: 1,
      compiledAt: new Date().toISOString(),
      provider: { name: config.queue.adapter === 'postgres' ? 'pgboss' : 'bullmq' },
      logger: { name: 'console', level: 'info' },
      runner: { ts: { isolate: 'inprocess' }, py: { enabled: false, cmd: 'python3', importMode: 'file' } },
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
    const TRIGGER_REGISTRY_TEMPLATE = 'trigger-registry.mjs'

    // add dynamic ts files to build transpile list
    for (const templateName of [REGISTRY_TEMPLATE, HANDLERS_TEMPLATE, ANALYZED_FLOWS_TEMPLATE, TRIGGER_REGISTRY_TEMPLATE] as const) {
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

    addTemplate({
      filename: TRIGGER_REGISTRY_TEMPLATE,
      write: true,
      getContents: () => generateTriggerRegistryTemplate(lastCompiledRegistry),
    })

    // Add type template for adapter interfaces
    // This allows external packages to import types via #nvent/adapters
    addTypeTemplate({
      filename: 'types/nvent-adapters.d.ts',
      getContents: () => `
// Auto-generated adapter type definitions
// External adapter packages can import these types

// Queue Adapter
export type {
  QueueAdapter,
  JobInput,
  Job,
  JobsQuery,
  JobOptions,
  JobState,
  ScheduleOptions,
  JobCounts,
  QueueEvent,
  WorkerHandler,
  WorkerContext,
  WorkerOptions,
} from ${JSON.stringify(resolve('./runtime/adapters/interfaces/queue'))}

// Stream Adapter
export type {
  StreamAdapter,
  StreamEvent,
  SubscribeOptions,
  SubscriptionHandle,
} from ${JSON.stringify(resolve('./runtime/adapters/interfaces/stream'))}

// Store Adapter
export type {
  StoreAdapter,
  EventRecord,
  EventReadOptions,
  EventSubscription,
  ListOptions,
} from ${JSON.stringify(resolve('./runtime/adapters/interfaces/store'))}

// Event Types
export type {
  EventType,
  BaseEvent,
  StepEvent,
  FlowStartEvent,
  FlowCompletedEvent,
  FlowFailedEvent,
  FlowCancelEvent,
  FlowStalledEvent,
  StepStartedEvent,
  StepCompletedEvent,
  StepFailedEvent,
  StepRetryEvent,
  LogEvent,
  EmitEvent,
  StateEvent,
  FlowEvent,
} from ${JSON.stringify(resolve('./runtime/events/types'))}

// Adapter Registry
export type { AdapterRegistry } from ${JSON.stringify(resolve('./runtime/adapters/registry'))}
      `.trim(),
    })

    nuxt.options.alias['#nvent/adapters'] = resolve(nuxt.options.buildDir, 'types/nvent-adapters')

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
      {
        name: 'useTriggerRegistry',
        as: '$useTriggerRegistry',
        from: resolve(nuxt.options.buildDir, 'trigger-registry'),
      },
      // Core utilities for user code
      {
        name: 'defineFunctionConfig',
        from: resolve('./runtime/utils/defineFunctionConfig'),
      },
      {
        name: 'defineFunction',
        from: resolve('./runtime/utils/defineFunction'),
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
      },
      {
        name: 'useHookRegistry',
        from: resolve('./runtime/utils/useHookRegistry'),
      },
      {
        name: 'useAwait',
        from: resolve('./runtime/utils/useAwait'),
      },
      {
        name: 'useRunContext',
        from: resolve('./runtime/utils/useRunContext'),
      },
      {
        name: 'defineAwaitRegisterHook',
        from: resolve('./runtime/utils/defineHooks'),
      },
      {
        name: 'defineAwaitResolveHook',
        from: resolve('./runtime/utils/defineHooks'),
      },
      {
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
      }, {
        name: 'useTrigger',
        from: resolve('./runtime/utils/useTrigger'),
      }, {
        name: 'useAwait',
        from: resolve('./runtime/utils/useAwait'),
      },
      // Adapter registration utilities for external modules
      {
        name: 'registerQueueAdapter',
        from: resolve('./runtime/utils/registerAdapter'),
      },
      {
        name: 'registerStreamAdapter',
        from: resolve('./runtime/utils/registerAdapter'),
      },
      {
        name: 'registerStoreAdapter',
        from: resolve('./runtime/utils/registerAdapter'),
      },
    ])

    // Small helper to refresh registry and re-generate app (dev)
    const refreshRegistry = async (reason: string, changedPath?: string) => {
      const functionsDir = config.dir || 'functions'
      const updatedRegistry = await compileRegistryFromServerWorkers(layerInfos, functionsDir, defaultConfigs)
      // No merging: the compiled registry is the single source of truth
      lastCompiledRegistry = JSON.parse(JSON.stringify(defu(updatedRegistry, {
        version: 1,
        compiledAt: new Date().toISOString(),
        provider: { name: config.queue.adapter === 'postgres' ? 'pgboss' : 'bullmq' },
        logger: { name: 'console', level: 'info' },
        runner: { ts: { isolate: 'inprocess' }, py: { enabled: false, cmd: 'python3', importMode: 'file' } },
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
            || template.filename === TRIGGER_REGISTRY_TEMPLATE
          if (match) {
            console.log(`[nuxt-queue] updating template: ${template.filename}`)
          }
          return match
        },
      })

      console.log(`[nuxt-queue] templates updated`)
    }

    if (nuxt.options.dev) {
      // Watch for changes in function files and rebuild registry
      const functionsDir = config.dir || 'functions'

      // Use chokidar-based watcher for reliable file watching
      // Vite HMR handles component updates automatically when templates change
      watchQueueFiles({
        nuxt,
        layerInfos,
        queuesDir: functionsDir,
        onRefresh: refreshRegistry,
      })
    }
  },
})

export type { ModuleOptions } from './runtime/config/types'
