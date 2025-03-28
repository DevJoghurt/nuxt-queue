import { platform } from 'node:os'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { Worker, MetricsTime } from 'bullmq'
import type { WorkerOptions as BullmqWorkerOptions, Processor, RedisOptions } from 'bullmq'
import { consola } from 'consola'
import { useRuntimeConfig } from '#imports'

type WorkerInstance = {
  id: string
  name: string
  processor: Worker
  runtype: 'spawn' | 'workerThreads' | 'intern'
}

export type WorkerOptions = Omit<BullmqWorkerOptions, 'connection'>

const workerInstances = [] as WorkerInstance[]

export function $useWorker() {
  const logger = consola.create({}).withTag('QUEUE')

  const getWorkerInstances = (identifier?: string) => {
    let resWorkerInstances = null
    if (typeof identifier === 'string') {
      resWorkerInstances = workerInstances.filter(w => w.name === identifier)
      if (!resWorkerInstances) {
        resWorkerInstances = workerInstances.filter(w => w.id === identifier)
      }
    }
    else {
      resWorkerInstances = workerInstances
    }

    return resWorkerInstances
  }

  const getWorker = (id: string) => {
    return workerInstances.find(w => w.id === id)?.processor as Worker
  }

  const createWorker = (name: string, processor: string | URL | Processor, options?: WorkerOptions) => {
    const { redis } = useRuntimeConfig().queue

    let runtype = 'intern' as WorkerInstance['runtype']

    if (typeof processor === 'string') {
      processor = resolveRuntimePath(processor)
      runtype = options?.useWorkerThreads && options.useWorkerThreads === true ? 'workerThreads' : 'spawn'
    }

    const connection = {
      host: redis.host,
      port: redis.port,
    } as RedisOptions
    if (redis?.password) {
      connection.password = redis.password
    }
    if (redis?.username) {
      connection.username = redis.username
    }

    const worker = new Worker(name, processor, {
      connection,
      ...Object.assign(options || {}, {
        metrics: {
          maxDataPoints: MetricsTime.ONE_WEEK * 2,
        },
      }),
    })

    workerInstances.push({
      id: worker.id,
      name: name,
      processor: worker,
      runtype,
    })
    logger.success(`Worker '${name}' with id '${worker.id}' started successfully`)
  }

  const closeWorker = async (identifier?: string) => {
    const filteredWorkerInstances = getWorkerInstances(identifier)
    const cachedRemoveIndexes = [] as number[]
    for (const workerInstance of filteredWorkerInstances) {
      logger.success(`Close worker process '${workerInstance.name}' with id '${workerInstance.id}'`)
      await workerInstance.processor.close()
      cachedRemoveIndexes.push(workerInstances.findIndex(p => p.id === workerInstance.id))
    }
    for (const workerIndex of cachedRemoveIndexes) {
      workerInstances.splice(workerIndex, 1)
    }
    logger.success('Worker closed successfully')
  }

  const resolveRuntimePath = (script: string) => {
    const { runtimeDir } = useRuntimeConfig().queue
    let scriptPath = join(runtimeDir, script)
    if (runtimeDir === 'build') {
      scriptPath = join(process.cwd(), `/worker/${script}`)
    }
    // BullMQ uses urls file for windows to run sandboxed scripts
    if (platform() === 'win32') {
      return pathToFileURL(scriptPath)
    }
    return scriptPath
  }

  return {
    getWorkerInstances,
    getWorker,
    createWorker,
    closeWorker,
    resolveRuntimePath,
  }
}
