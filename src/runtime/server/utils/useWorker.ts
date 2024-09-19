import { platform } from 'node:os'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { Worker, MetricsTime } from 'bullmq'
import type { WorkerOptions as BullmqWorkerOptions, Processor } from 'bullmq'
import { consola } from 'consola'
import { useRuntimeConfig } from '#imports'

type WorkerInstance = {
  id: string
  name: string
  processor: Worker
  runtype: 'spawn' | 'worker' | 'intern'
}

export type WorkerOptions = Omit<BullmqWorkerOptions, 'connection' >

const workerInstances = [] as WorkerInstance[]

export function $useWorker() {
  const logger = consola.create({}).withTag('QUEUE')

  const getWorkerInstances = (identifier: string | null) => {
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
      runtype = options?.useWorkerThreads && options.useWorkerThreads === true ? 'worker' : 'spawn'
    }

    const worker = new Worker(name, processor, {
      connection: {
        host: redis.host,
        port: redis.port,
      },
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

  const closeWorker = async (identifier: string | null) => {
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
    // BullMQ uses for windows file urls to run sandboxed scripts
    if (platform() === 'win32') {
      return pathToFileURL(`${scriptPath}.js`)
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
