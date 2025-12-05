import { join } from 'node:path'
import {
  defineNuxtModule,
  createResolver,
  addServerPlugin,
  addServerHandler,
  addServerImports,
  addTemplate,
  addTypeTemplate,
  updateTemplates,
} from '@nuxt/kit'
import defu from 'defu'
import { compileRegistryFromServerWorkers, type LayerInfo } from './registry'
import { watchQueueFiles } from './utils/dev'
import { generateRegistryTemplate, generateHandlersTemplate, generateAnalyzedFlowsTemplate, generateTriggerRegistryTemplate, generateAdapterTypesTemplate } from './utils/templates'
import { getServerImports } from './utils/serverImports'
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

export default defineNuxtModule<ModuleOptions>().with({
  meta,
  defaults: {},
  async setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url)

    // In Nuxt 4, we need to merge both options parameter AND nuxt.options[configKey]
    const userConfig = (nuxt.options as any)[meta.configKey] || {}
    const mergedOptions = { ...userConfig, ...options }

    // Normalize and merge configuration
    const config = normalizeModuleOptions(mergedOptions)

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
      config: {
        flow: config.flow,
        queue: config.queue,
      },
    })
    // Ensure plain JSON snapshot to avoid readonly/proxy issues in Nitro normalization
    const compiledSnapshot = JSON.parse(JSON.stringify(compiledWithMeta))
    // Keep a mutable reference for dev updates
    let lastCompiledRegistry = compiledSnapshot

    // Template filenames for reference
    const REGISTRY_TEMPLATE = 'function-registry.mjs'
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
      getContents: () => generateAdapterTypesTemplate(resolve),
    })
    nuxt.options.alias['#nvent/adapters'] = resolve(nuxt.options.buildDir, 'types/nvent-adapters')

    // Add server plugin to initialize nvent in Nitro
    addServerPlugin(resolve('./runtime/nitro/plugins/00.adapters'))
    addServerPlugin(resolve('./runtime/nitro/plugins/01.ws-lifecycle'))
    addServerPlugin(resolve('./runtime/nitro/plugins/02.workers'))
    addServerPlugin(resolve('./runtime/nitro/plugins/03.triggers'))

    // add webhook handler
    addServerHandler({
      route: '/api/_webhook/await/:flowName/:runId/:stepName',
      handler: resolve('./runtime/nitro/routes/webhook.await'),
    })
    addServerHandler({
      route: '/api/_webhook/trigger/:triggerName',
      handler: resolve('./runtime/nitro/routes/webhook.trigger'),
    })

    // Add server auto-imports
    addServerImports(getServerImports(resolve, nuxt.options.buildDir))

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
        config: {
          flow: config.flow,
          queue: config.queue,
        },
      })))

      console.log(`[nvent] registry refreshed (${reason})`, changedPath || '')
      console.log(`[nvent] new registry has ${lastCompiledRegistry.workers?.length || 0} workers`)
      console.log(`[nvent] new registry compiled at: ${lastCompiledRegistry.compiledAt}`)

      // Update templates to trigger regeneration
      await updateTemplates({
        filter: (template) => {
          const match = template.filename === REGISTRY_TEMPLATE
            || template.filename === HANDLERS_TEMPLATE
            || template.filename === ANALYZED_FLOWS_TEMPLATE
            || template.filename === TRIGGER_REGISTRY_TEMPLATE
          if (match) {
            console.log(`[nvent] updating template: ${template.filename}`)
          }
          return match
        },
      })

      console.log(`[nvent] templates updated`)
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
