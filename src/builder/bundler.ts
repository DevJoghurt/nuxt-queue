import * as rollup from 'rollup'
import { useLogger } from '@nuxt/kit'
import type { RollupConfig } from './config'

/**
 * Watcher for rollup build in dev mode
 * @param rollupConfig 
 */
export function watchRollupEntry(rollupConfig: RollupConfig){
    const logger = useLogger()
    const watcher = rollup.watch(rollupConfig)
    let start = null as null | number
  
    watcher.on('event', (event) => {
      switch (event.code) {
        // The watcher is (re)starting
        case 'START':
          return
  
        // Building an individual bundle
        case 'BUNDLE_START':
          start = Date.now()
          return
  
        // Finished building all bundles
        case 'END':
          //nitroContext._internal.hooks.callHook('nitro:compiled', nitroContext)
          logger.info(`Queue worker` + ' built', start ? `in ${Date.now() - start} ms` : '')
          return
  
        // Encountered an error while bundling
        case 'ERROR':
          logger.error('Queue Rollup error: ' + event.error)
          // consola.error(event.error)
      }
    })
}