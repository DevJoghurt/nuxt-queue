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

  const entryFiles = {} as Record<string, string>
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
          id: generatedID,
          name: meta,
        }
      }
      if (typeof meta === 'object') {
        meta = defu(meta, {
          id: generatedID,
        })
      }
      const workerConfigArgs = mod.exports.default?.$args[2] || {} as WorkerConfig
      if (typeof workerConfig[meta.id] === 'undefined') {
        workerConfig[meta.id] = workerConfigArgs
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

        entryFiles[meta.id] = `${options.rootDir}/${file}`

        registeredWorker.push(defu({
          id: meta.id,
          name: meta.name,
          script: `${meta.id}.mjs`,
          options: {
            ...workerConfigArgs,
          },
        }, {
          options: {
            ...workerDefaults,
          },
        }))
        // create queue config
        queues[meta.id] = {
          runtime: 'pm2',
          remote: false,
        }
      }
      else {
        logger.error(`Worker [${meta.name}]`, `Id ${meta.id} already taken. Please change the worker file name.`)
      }
    }
    else {
      logger.error('Worker:', file, 'Found no default export. Please use export default defineWorker() syntax.')
    }
  }

  logger.success('Initialized worker:', registeredWorker.map(w => w.id))

  return {
    entryFiles,
    queues,
    workers: registeredWorker,
  }
}
