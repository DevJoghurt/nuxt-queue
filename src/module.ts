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
import { normalizeModuleOptions, toRuntimeConfig, getRedisStorageConfig } from './config'
import type { ModuleOptions, QueueModuleConfig } from './config/types'
import type {} from '@nuxt/schema'

const meta = {
  name: 'queue',
  version: '0.1',
  configKey: 'queue',
}

declare module '@nuxt/schema' {
  interface RuntimeConfig {
    queue: QueueModuleConfig
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

    addServerScanDir(resolve('./runtime/server'))

    // Add shared utilities for both app and server
    addImportsDir(resolve('./runtime/shared/utils'))

    addImportsDir(resolve('./runtime/app/composables'))

    // add vueflow assets

    if (config.ui) {
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
    runtimeConfig.queue = defu(runtimeConfig.queue || {}, toRuntimeConfig(config)) as any

    // Build real registry snapshot from disk
    const layerInfos: LayerInfo[] = nuxt.options._layers.map(l => ({
      rootDir: l.config.rootDir,
      serverDir: l.config?.serverDir || join(l.config.rootDir, 'server'),
    }))

    // Prepare default configs from normalized config
    // Extract queue options (excluding worker)
    const { worker: _worker, ...queueOptions } = config.queue.defaultConfig || {}
    const defaultConfigs = {
      queue: queueOptions,
      worker: config.queue.defaultConfig?.worker,
    }

    const compiledRegistry = await compileRegistryFromServerWorkers(layerInfos, config.dir || 'queues', defaultConfigs)
    // augment with defaults and metadata
    const compiledWithMeta = defu(compiledRegistry, {
      version: 1,
      compiledAt: new Date().toISOString(),
      provider: { name: config.queue.name === 'postgres' ? 'pgboss' : 'bullmq' },
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
      const queuesRel = config.dir || 'queues'
      const updatedRegistry = await compileRegistryFromServerWorkers(layerInfos, queuesRel, defaultConfigs)
      // No merging: the compiled registry is the single source of truth
      lastCompiledRegistry = JSON.parse(JSON.stringify(defu(updatedRegistry, {
        version: 1,
        compiledAt: new Date().toISOString(),
        provider: { name: config.queue.name === 'postgres' ? 'pgboss' : 'bullmq' },
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

export type { ModuleOptions } from './config/types'
