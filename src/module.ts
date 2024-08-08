import { _tasks } from 'node:process'
import {
  defineNuxtModule,
  createResolver,
  addServerScanDir,
  addServerImportsDir,
  addImportsDir,
  installModule,
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
    redis: {
      host: '127.0.0.1',
      port: 6379,
    },
  },
  async setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url)

    // check if @nuxt/ui is installed
    await installModule('@nuxt/ui')

    addServerScanDir(resolve('./runtime/server'))

    addServerImportsDir(resolve('./runtime/handlers'))

    addImportsDir(resolve('./runtime/composables'))

    addComponentsDir({
      path: resolve('./runtime/components'),
      prefix: 'Queue',
    })

    addComponent({
      name: 'QueueApp',
      filePath: resolve('./runtime/app/index.vue'),
      global: true,
    })

    const runtimeConfig = nuxt.options.runtimeConfig

    runtimeConfig.queue = defu(runtimeConfig?.queue || {}, {
      mode: nuxt.options.dev ? 'dev' : 'prod',
      runtimeDir: nuxt.options.dev ? `${nuxt.options.buildDir}/worker` : 'build',
      redis: options.redis,
    })

    // add tailwindcss support
    nuxt.hook('tailwindcss:config', (tailwindConfig) => {
      tailwindConfig.content = tailwindConfig.content || []
      // @ts-ignore
      tailwindConfig.content.files = tailwindConfig.content.files || []
      // @ts-ignore
      tailwindConfig.content.files.push(resolve('./runtime/app/**/*.{vue,js,ts}'))
      // @ts-ignore
      tailwindConfig.content.files.push(resolve('./runtime/components/**/*.{vue,js,ts}'))
    })

    // Alias for worker config with meta information
    nuxt.hook('nitro:config', (nitroConfig) => {
      // add missing file to use pm2 in production build
      nitroConfig.externals?.traceInclude?.push('node_modules/pm2/lib/ProcessContainerFork.js')
      // add websocket support
      nitroConfig.experimental = defu(nitroConfig.experimental, {
        websocket: true,
        tasks: true,
      })
    })

    // initialize worker and queues
    const { entryFiles, queues, workers } = await initializeWorker({
      rootDir: nuxt.options.rootDir,
      workerDir: options.dir,
      buildDir: nuxt.options.buildDir,
    })

    nuxt.options.runtimeConfig.queue = defu(nuxt.options.runtimeConfig.queue || {}, {
      queues: defu(queues, options.queues),
      workers,
    })

    // start build process
    let rollupConfig = null as null | RollupConfig

    // BUILD WORKER for production
    nuxt.hook('nitro:build:public-assets', async (nitro) => {
      rollupConfig = getRollupConfig(entryFiles, {
        buildDir: nitro.options.output.serverDir,
        nitro: nitro.options,
      })

      await buildWorker(rollupConfig)
    })

    // ONLY IN DEV MODE
    if (nuxt.options.dev) {
      nuxt.hook('nitro:init', (nitro) => {
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
