import { loadFile } from 'magicast'
import { globby } from 'globby'
import { useLogger } from '@nuxt/kit'
import defu from 'defu'
import { createInProcessWorkerComposable } from './templates'
import type { WorkerConfig, RegisteredWorker } from './types'
import type { QueueOptions, WorkerRuntype } from './types.js'
import type { NitroOptions } from 'nitropack'
import { ca } from 'zod/v4/locales'

type WorkerConfigOptions = {
  cwd?: string
  workerDir: string
  generatedID?: string
}

/**
 * Convert an AST node to a plain object
 * @param node
 * @returns
 */
function astToObject(node: any): any {
  if (!node) return undefined;
  if (node.type === 'ObjectExpression') {
    const obj: any = {};
    for (const prop of node.properties) {
      let key;
      if (prop.key.type === 'Identifier') key = prop.key.name;
      else if (prop.key.type === 'Literal' || prop.key.type === 'StringLiteral' || prop.key.type === 'NumericLiteral') key = prop.key.value;
      else continue;
      obj[key] = astToObject(prop.value);
    }
    return obj;
  }
  if (node.type === 'ArrayExpression') {
    return node.elements.map(astToObject);
  }
  if (node.type === 'Literal' || node.type === 'StringLiteral' || node.type === 'NumericLiteral' || node.type === 'BooleanLiteral') {
    return node.value;
  }
  if (node.type === 'Identifier') {
    return node.name;
  }
  // Add more cases as needed
  return undefined;
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

  let generatedID = options.generatedID || file.replace(`${options.workerDir}/`, '').split('.').slice(0, -1).join('.')
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
    const fullPathFile = options.cwd ? `${options.cwd}/${file}` : file
    mod = await loadFile(fullPathFile)
  }
  catch (e) {
    logger.error('Worker', e)
    return null
  }

  if (mod.exports.default?.$type === 'function-call') {
    let meta = mod.exports.default?.$args[0] || ''
    if(runtype === 'task'){
      try {
        const astNode = mod.exports.default?.$ast.arguments[0].properties[0].value
        meta = astToObject(astNode)
        if(!meta.runtype || meta.runtype !== 'queue'){
          return null
        }
      } catch (e) {
        logger.error('Worker', e)
        return null
      }
    }
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
      cwd: options?.cwd || '',
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
  tasks: NitroOptions['tasks']
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

  // add tasks
  for(const task in options.tasks) {
    if(!options.tasks[task]?.handler){
      continue
    }
    const file = options.tasks[task]?.handler
    // get filename to generate id: C:/Code/nuxt-queue/playground/server/tasks/task_testing.ts -> task_testing
    const generatedID = file.split('/').pop()?.split('.').slice(0, -1).join('.')
    const meta = await createWorkerConfig(file, 'task', {
      generatedID,
      workerDir: 'tasks'
    })
    if(!meta){
      continue
    }

    console.log('Initialized task worker:', meta)
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
