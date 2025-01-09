import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  defineNuxtModule,
  createResolver,
  addServerScanDir,
  addServerImportsDir,
  addServerImports,
  addImportsDir,
  addComponent,
  addComponentsDir,
  installModule,
  hasNuxtModule,
} from '@nuxt/kit'
import defu from 'defu'
import { getRollupConfig, type RollupConfig } from './builder/config'
import { watchRollupEntry, buildWorker } from './builder/bundler'
import { initializeWorker } from './utils'
import type { ModuleOptions, QueueOptions, RegisteredWorker } from './types'
import type {} from '@nuxt/schema'

const meta = {
  name: 'queue',
  version: '0.1',
  configKey: 'queue',
}

declare module '@nuxt/schema' {
  interface RuntimeConfig {
    queue: {
      runtimeDir: string
      redis: ModuleOptions['redis']
      queues: Record<string, Omit<QueueOptions, 'connection'>>
      workers: RegisteredWorker[]
    }
  }
}

export default defineNuxtModule<ModuleOptions>({
  meta,
  defaults: {
    dir: 'queues',
    runtimeDir: '',
    ui: false,
    redis: {
      host: '127.0.0.1',
      port: 6379,
    },
  },
  async setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url)

    addServerScanDir(resolve('./runtime/server'))

    addServerImportsDir(resolve('./runtime/handlers'))

    addImportsDir(resolve('./runtime/composables'))

    if (options.ui) {
      addComponentsDir({
        path: resolve('./runtime/components'),
        prefix: 'Queue',
      })

      addComponent({
        name: 'QueueApp',
        filePath: resolve('./runtime/app/index.vue'),
        global: true,
      })
    }

    // add jsoneditor to vite optimize -> for esm support
    nuxt.options.vite.optimizeDeps = defu(nuxt.options.vite.optimizeDeps, {
      include: ['vanilla-jsoneditor'],
    })

    // add nuxt ui with tailwind support
    if (!hasNuxtModule('@nuxt/ui')) {
      installModule('@nuxt/ui')
      nuxt.options.css.push(resolve('./runtime/tailwind.css'))
    }
    // add json-editor-vue module
    installModule('json-editor-vue/nuxt')

    // Alias for worker config with meta information
    nuxt.hook('nitro:config', (nitroConfig) => {
      // TODO: better resolving of bullmq module by using nuxt resolver tools
      nitroConfig.externals?.traceInclude?.push('node_modules/bullmq/dist/cjs/classes/main.js')
      // add websocket support
      nitroConfig.experimental = defu(nitroConfig.experimental, {
        websocket: true,
      })
    })

    // initialize worker and queues
    const { queues, workers } = await initializeWorker({
      rootDir: nuxt.options.rootDir,
      serverDir: nuxt.options.serverDir,
      workerDir: options?.dir || 'queues',
      buildDir: nuxt.options.buildDir,
    })

    // add in-process worker composable
    addServerImports([{
      name: 'useWorkerProcessor',
      as: '$useWorkerProcessor',
      from: resolve(nuxt.options.buildDir, 'inprocess-worker-composable'),
    }])

    const runtimeConfig = nuxt.options.runtimeConfig

    runtimeConfig.queue = defu(runtimeConfig.queue || {}, {
      runtimeDir: nuxt.options.dev ? `${nuxt.options.buildDir}/worker` : 'build',
      redis: options.redis,
      queues: defu(queues, options.queues),
      workers,
    })

    // start build process
    let rollupConfig = null as null | RollupConfig

    // BUILD SANDBOXED WORKER for production
    nuxt.hook('nitro:build:public-assets', async (nitro) => {
      if (workers.filter(w => w.runtype === 'sandboxed').length === 0) return // no building if no entry files
      // add worker directory
      mkdirSync(join(nitro.options.output.dir, 'worker'), {
        recursive: true,
      })
      // create build config
      rollupConfig = getRollupConfig(workers, {
        rootDir: nuxt.options.rootDir,
        buildDir: nitro.options.output.serverDir,
        nitro: nitro.options,
      })

      await buildWorker(rollupConfig)
    })

    // BUILD SANDBOXED WORKER ONLY IN DEV MODE
    if (nuxt.options.dev) {
      nuxt.hook('nitro:init', (nitro) => {
        if (workers.filter(w => w.runtype === 'sandboxed').length === 0) return // no building if no entry files
        // add worker directory
        mkdirSync(join(nuxt.options.buildDir, 'worker'), {
          recursive: true,
        })
        rollupConfig = getRollupConfig(workers, {
          rootDir: nuxt.options.rootDir,
          buildDir: nuxt.options.buildDir,
          nitro: nitro.options,
        })
        watchRollupEntry(rollupConfig)
      })
    }
    // ONLY IN DEV MODE
  },
})
