import {
  defineNuxtModule,
  useLogger,
  createResolver,
  addServerScanDir,
  addServerImportsDir,
  addServerHandler,
  addImportsDir
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

export default defineNuxtModule<ModuleOptions>({
  meta,
  defaults: {
      dir: 'worker',
      runtimeDir: '',
      redis: {
          host: "localhost",
          port: 6379
      }
  },
  async setup(options, nuxt) {
      const { resolve } = createResolver(import.meta.url)
      const logger = useLogger(meta.name)

      addServerScanDir(resolve('./runtime/server'))

      addServerImportsDir(resolve('./runtime/handlers'))

      addImportsDir(resolve('./runtime/composables'))

      // Transpile BullBoard api because its not ESM
      nuxt.options.build.transpile.push("@bull-board/api")
      nuxt.options.build.transpile.push("@bull-board/h3")
      nuxt.options.build.transpile.push("@bull-board/ui")

      // Add Server handlers for UI
      addServerHandler({
        route: "/_queue",
        handler: resolve("./runtime/routes/bullBoard.ts"),
      });

      addServerHandler({
        route: "/_queue/**",
        handler: resolve("./runtime/routes/bullBoard.ts"),
      });

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

      const runtimeConfig = nuxt.options.runtimeConfig

      runtimeConfig.queue = defu(runtimeConfig?.queue || {}, {
        runtimeDir: `${nuxt.options.buildDir}/worker`,
        redis: options.redis
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