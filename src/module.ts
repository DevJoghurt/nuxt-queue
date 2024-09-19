import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  defineNuxtModule,
  createResolver,
  addServerScanDir,
  addServerImportsDir,
  addImportsDir,
  addComponent,
  addComponentsDir,
} from '@nuxt/kit'
import defu from 'defu'
import { getRollupConfig, type RollupConfig } from './builder/config'
import { watchRollupEntry, buildWorker } from './builder/bundler'
import { initializeWorker } from './utils'
import type { ModuleOptions } from './types'

const meta = {
  name: 'queue',
  version: '0.1',
  configKey: 'queue',
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

    // add tailwindcss support
    nuxt.hook('tailwindcss:config', (tailwindConfig) => {
      if (!Array.isArray(tailwindConfig.content) && tailwindConfig.content?.files) {
        tailwindConfig.content.files.push(resolve('./runtime/app/**/*.{vue,js,ts}'))
        tailwindConfig.content.files.push(resolve('./runtime/components/**/*.{vue,js,ts}'))
      }
    })

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
    const { entryFiles, queues, workers } = await initializeWorker({
      rootDir: nuxt.options.rootDir,
      workerDir: options.dir,
      buildDir: nuxt.options.buildDir,
    })

    const runtimeConfig = nuxt.options.runtimeConfig

    runtimeConfig.queue = defu(runtimeConfig.queue || {}, {
      runtimeDir: nuxt.options.dev ? `${nuxt.options.buildDir}/worker` : 'build',
      redis: options.redis,
      queues: defu(queues, options.queues),
      workers,
    })

    // start build process
    let rollupConfig = null as null | RollupConfig

    // BUILD WORKER for production
    nuxt.hook('nitro:build:public-assets', async (nitro) => {
      if (!entryFiles) return // no building if no entry files
      // add worker directory
      mkdirSync(join(nitro.options.output.dir, 'worker'), {
        recursive: true,
      })
      // create build config
      rollupConfig = getRollupConfig(entryFiles, {
        buildDir: nitro.options.output.serverDir,
        nitro: nitro.options,
      })

      await buildWorker(rollupConfig)
    })

    // BUILD WORKER ONLY IN DEV MODE
    if (nuxt.options.dev) {
      nuxt.hook('nitro:init', (nitro) => {
        if (!entryFiles) return // no building if no entry files
        // add worker directory
        mkdirSync(join(nuxt.options.buildDir, 'worker'), {
          recursive: true,
        })
        rollupConfig = getRollupConfig(entryFiles, {
          buildDir: nuxt.options.buildDir,
          nitro: nitro.options,
        })
        watchRollupEntry(rollupConfig)
      })
    }
    // ONLY IN DEV MODE
  },
})
