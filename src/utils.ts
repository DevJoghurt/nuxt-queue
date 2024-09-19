import { loadFile } from 'magicast'
import { globby } from 'globby'
import { useLogger } from '@nuxt/kit'
import defu from 'defu'
import type { WorkerConfig, WorkerOptions, RegisteredWorker } from './types'
import type { QueueOptions } from './types.js'

type InitializeWorkerOptions = {
  workerDir: string
  rootDir: string
  buildDir: string
}

/**
 * Initialize worker and return entry files
 * creates a meta json file that has all the important information of the workers
 *
 * @param options
 * @returns RegisteredWorker[]
 *
 */
export async function initializeWorker(options: InitializeWorkerOptions) {
  const logger = useLogger()

  // scan files and find worker entry files
  const files = await globby(`${options.workerDir}/**/*.{ts,js,mjs}`, {
    cwd: options.rootDir,
    deep: 2,
  })

  let entryFiles = null as Record<string, string> | null
  const queues = {} as Record<string, QueueOptions>
  const registeredWorker = [] as RegisteredWorker[]
  // read worker configuration and write it as meta config file
  const workerConfig = {} as WorkerConfig
  for (const file of files) {
    let generatedID = file.replace(`${options.workerDir}/`, '').split('.').slice(0, -1).join('.')
    // check if file path has a folder -> generatedID must be split
    if (generatedID.includes('/')) {
      const fileNameArray = generatedID.split('/')
      if (fileNameArray.length === 2 && fileNameArray[1] === 'queue') {
        generatedID = fileNameArray[0]
      }
      else {
        // no worker entry -> check next one
        continue
      }
    }

    let mod = null

    try {
      mod = await loadFile(`${options.rootDir}/${file}`)
    }
    catch (e) {
      logger.error('Worker', e)
      continue
    }

    if (mod.exports.default?.$type === 'function-call') {
      let meta = mod.exports.default?.$args[0] || ''
      if (typeof meta === 'string') {
        meta = {
          name: meta,
        }
      }
      if (typeof meta === 'object') {
        meta = defu(meta, {
          name: meta.name || generatedID,
        })
      }
      const workerConfigArgs = meta as WorkerConfig
      if (typeof workerConfig[meta.name] === 'undefined') {
        workerConfig[meta.name] = workerConfigArgs
        const workerDefaults = {
          autorun: true,
          concurrency: 1,
          drainDelay: 5,
          lockDuration: 30000,
          maxStalledCount: 1,
          runRetryDelay: 15000,
          skipLockRenewal: false,
          skipStalledCheck: false,
          skipVersionCheck: false,
          stalledInterval: 30000,
        } as WorkerOptions

        entryFiles = entryFiles || {}
        entryFiles[meta.name] = `${options.rootDir}/${file}`

        registeredWorker.push(defu({
          name: meta.name,
          script: `${meta.name}.js`,
          options: {
            ...workerConfigArgs,
          },
        }, {
          options: {
            ...workerDefaults,
          },
        }))
        // create queue config
        queues[meta.name] = {
          origin: 'local',
        }
      }
      else {
        logger.error(`Worker [${meta.name}]`, `Worker already exists. Please change the worker file name.`)
      }
    }
    else {
      logger.error('Worker:', file, 'Found no default export. Please use export default defineWorker() syntax.')
    }
  }

  logger.success('Initialized worker:', registeredWorker.map(w => w.name))

  return {
    entryFiles,
    queues,
    workers: registeredWorker,
  }
}
