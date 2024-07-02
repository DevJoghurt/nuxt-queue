import {
  defineNuxtModule,
  useLogger,
  createResolver,
  addServerScanDir,
  addServerImportsDir
} from "@nuxt/kit"
import { getRollupConfig, type RollupConfig } from "./builder/config"
import { watchRollupEntry } from './builder/bundler'
import { initializeWorker } from './utils'
import type { RegisteredWorker } from './types'
import defu from 'defu'


const meta = {
  name: 'queue',
  version: '0.1',
  configKey: 'queue'
}


export interface ModuleOptions {
  dir: string;
  redis: {
      host: string;
      port: number;
  };
}

export default defineNuxtModule<ModuleOptions>({
  meta,
  defaults: {
      dir: 'worker',
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

      const runtimeConfig = nuxt.options.runtimeConfig

      runtimeConfig.queue = defu(runtimeConfig?.queue || {}, {
          redis: options.redis
      })

      //createTemplateTypes()

      // ONLY IN DEV MODE
      if(nuxt.options.dev){

          //initialize worker
          let registeredWorker = await initializeWorker({
              rootDir: nuxt.options.rootDir,
              workerDir: options.dir,
              buildDir: nuxt.options.buildDir
          })

          // start build process
          let rollupConfig = null as null | RollupConfig

          /*
          nuxt.hook('nitro:init', (nitroCtx)=>{
              rollupConfig = getRollupConfig(workerEntryFiles, {
                  buildDir: nuxt.options.buildDir,
                  nitro: nitroCtx.options
              })
              watchRollupEntry(rollupConfig)
          })
              */

          // Need watch hook to get update if files are added or removed from directory
          nuxt.options.watch.push(`${nuxt.options.rootDir}/${options.dir}/*`)
          nuxt.hook('builder:watch', async (eventType, dir) => {
              if(dir.includes(options.dir) && ['unlink', 'add'].indexOf(eventType) !== -1){
                  logger.info('builder:watch', eventType, dir)
                  registeredWorker = await initializeWorker({
                    rootDir: nuxt.options.rootDir,
                    workerDir: options.dir,
                    buildDir: nuxt.options.buildDir
                  })
              }
          })
      }
      // ONLY IN DEV MODE
  }
})