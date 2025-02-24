import { loadFile } from 'magicast'
import { globby } from 'globby'
import { useLogger } from '@nuxt/kit'
import defu from 'defu'
import { createInProcessWorkerComposable } from './templates'
import type { WorkerConfig, RegisteredWorker } from './types'
import type { QueueOptions, WorkerRuntype } from './types.js'

type WorkerConfigOptions = {
  cwd: string
  workerDir: string
}

/**
 * Analyze worker files and create a meta config
 * @param file
 * @param runtype
 * @param options
 * @returns WorkerConfig | null
 */
async function createWorkerConfig(file: string, runtype: WorkerRuntype, options: WorkerConfigOptions) {
  const logger = useLogger()

  let generatedID = file.replace(`${options.workerDir}/`, '').split('.').slice(0, -1).join('.')
  // check if file path has a folder -> generatedID must be split
  if (generatedID.includes('/')) {
    const fileNameArray = generatedID.split('/')
    if (fileNameArray.length === 2 && fileNameArray[1] === 'index') {
      generatedID = fileNameArray[0]
    }
    else {
      // no worker entry -> check next one
      return null
    }
  }

  let mod = null

  try {
    mod = await loadFile(`${options.cwd}/${file}`)
  }
  catch (e) {
    logger.error('Worker', e)
    return null
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
    const workerConfig = defu({
      name: meta.name,
      processor: (runtype === 'sandboxed') ? `${meta.name}.js` : 'function',
      cwd: options.cwd,
      file,
      runtype,
      options: {
        ...workerConfigArgs.options,
      },
    }, {
      options: {
        autorun: true,
        concurrency: 1,
        drainDelay: 5,
        lockDuration: 30000,
        maxStalledCount: 1,
        runRetryDelay: 15000,
        skipLockRenewal: false,
        skipStalledCheck: false,
        skipVersionCheck: false,
        useWorkerThreads: false,
        stalledInterval: 30000,
      },
    })
    return workerConfig
  }
  else {
    logger.error('Worker:', file, 'Found no default export. Please use export default defineWorker() syntax.')
  }
}

export type WorkerLayerPaths = {
  rootDir: string
  serverDir: string
}

type WorkerInitializeOptions = {
  layers: WorkerLayerPaths[]
  workerDir: string
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
export async function initializeWorker(options: WorkerInitializeOptions) {
  const logger = useLogger()

  const queues = {} as Record<string, QueueOptions>
  const registeredWorker = [] as RegisteredWorker[]

  for (const layer of options.layers) {
    // scan sandboxed worker files and find worker entry files
    const sandboxedFiles = await globby(`${options.workerDir}/**/*.{ts,js,mjs}`, {
      cwd: layer.rootDir,
      deep: 2,
    })
    // read worker configuration and write it as meta config file
    for (const file of sandboxedFiles) {
      const meta = await createWorkerConfig(file, 'sandboxed', {
        cwd: layer.rootDir,
        workerDir: options.workerDir,
      })
      if (meta) {
        registeredWorker.push(meta)
      }
    }

    // scan in-process worker files and find worker entry files
    const inProcessFiles = await globby(`${options.workerDir}/**/*.{ts,js,mjs}`, {
      cwd: layer.serverDir,
      deep: 2,
    })
    for (const file of inProcessFiles) {
      const meta = await createWorkerConfig(file, 'in-process', {
        cwd: layer.serverDir,
        workerDir: options.workerDir,
      })
      if (meta) {
        registeredWorker.push(meta)
      }
    }

  }

  // create in-process worker loader composable
  createInProcessWorkerComposable(registeredWorker)

  // create minimal queue config for each worker
  registeredWorker.map((w) => {
    queues[w.name] = {
      origin: 'local',
    }
  })

  logger.success('Initialized worker:', registeredWorker.map(w => w.name))

  return {
    queues,
    workers: registeredWorker,
  }
}
