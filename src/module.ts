import {
  defineNuxtModule,
  useLogger,
  createResolver,
  addServerScanDir,
  addServerImportsDir,
  addServerHandler,
  addImportsDir,
  installModule,
  addComponent,
  addComponentsDir
} from "@nuxt/kit"
import { getRollupConfig, type RollupConfig } from "./builder/config"
import { watchRollupEntry } from './builder/bundler'
import { initializeWorker } from './utils'
import defu from 'defu'


const meta = {
  name: 'queue',
  version: '0.1',
  configKey: 'queue'
}


export interface ModuleOptions {
  dir: string;
  runtimeDir: string;
  redis: {
      host: string;
      port: number;
  };
}

// check out how the build process is done: https://github.com/danielroe/nuxt-workers/tree/main?s=03 

export default defineNuxtModule<ModuleOptions>({
  meta,
  defaults: {
      dir: 'workers',
      runtimeDir: '',
      redis: {
          host: "127.0.0.1",
          port: 6379
      }
  },
  async setup(options, nuxt) {
      const { resolve } = createResolver(import.meta.url)
      const logger = useLogger(meta.name)


      //check if @nuxt/ui is installed
      await installModule('@nuxt/ui',{
        icons: ['heroicons']
      })

      addServerScanDir(resolve('./runtime/server'))

      addServerImportsDir(resolve('./runtime/handlers'))

      addImportsDir(resolve('./runtime/composables'))

      addComponentsDir({
        path: resolve('./runtime/components'),
        prefix: 'Queue'
      })

      addComponent({
        name: 'QueueApp',
        filePath: resolve('./runtime/app/index.vue'),
        global: true
      })

      // Transpile BullBoard api because its not ESM
      nuxt.options.build.transpile.push("@bull-board/api")
      nuxt.options.build.transpile.push("@bull-board/h3")
      nuxt.options.build.transpile.push("@bull-board/ui")

      // Add Server handlers for UI
      addServerHandler({
        route: "/_bull",
        handler: resolve("./runtime/routes/bullBoard.ts"),
      });

      addServerHandler({
        route: "/_bull/**",
        handler: resolve("./runtime/routes/bullBoard.ts"),
      });

      const runtimeConfig = nuxt.options.runtimeConfig

      runtimeConfig.queue = defu(runtimeConfig?.queue || {}, {
        runtimeDir: `${nuxt.options.buildDir}/worker`,
        redis: options.redis
      })

      //add tailwindcss support
      nuxt.hook('tailwindcss:config', (tailwindConfig) => {
        tailwindConfig.content = tailwindConfig.content || []
        tailwindConfig.content.files = tailwindConfig.content.files || []
        tailwindConfig.content.files.push(resolve('./runtime/app/**/*.{vue,js,ts}'))
        tailwindConfig.content.files.push(resolve('./runtime/components/**/*.{vue,js,ts}'))
      })


      //Alias for worker config with meta information
      nuxt.hook("nitro:config", (nitroConfig) => {
        // add websocket support
        nitroConfig.experimental =defu(nitroConfig.experimental,{
          websocket: true
        })
        //add worker alias
        if (!nitroConfig.alias) return
        nitroConfig.alias["#worker"] = `${nuxt.options.buildDir}/worker.config.ts`
      })

      // ONLY IN DEV MODE
      if(nuxt.options.dev){

          //initialize worker
          let workerEntryFiles = await initializeWorker({
              rootDir: nuxt.options.rootDir,
              workerDir: options.dir,
              buildDir: nuxt.options.buildDir
          })

          // start build process
          let rollupConfig = null as null | RollupConfig

          nuxt.hook('nitro:init', (nitroCtx)=>{
              rollupConfig = getRollupConfig(workerEntryFiles, {
                  buildDir: nuxt.options.buildDir,
                  nitro: nitroCtx.options
              })
              watchRollupEntry(rollupConfig)
          })

      }
      // ONLY IN DEV MODE
  }
})