import { consola } from 'consola'
import {
  $useQueue,
  $useWorker,
  useRuntimeConfig,
  defineNitroPlugin,
} from '#imports'

export default defineNitroPlugin(async (nitro) => {
  const logger = consola.create({}).withTag('QUEUE')

  const { initQueue, initQueueEvent, disconnect: disconnectQueues } = $useQueue()

  // const { launchProcess, closeProcess } = $useWorkerProcess()
  const { createWorker, closeWorker } = $useWorker()

  const { queues, workers } = useRuntimeConfig().queue

  /**
   *  Initialize queues
   */
  for (const queueName in queues) {
    initQueue(queueName, queues[queueName].options)
    initQueueEvent(queueName, queues[queueName].options)
  }

  /**
   *  Initialize sandboxed worker
   */
  for (const worker of workers) {
    if(worker.runtype === 'sandboxed'){
      createWorker(worker.name, worker.processor)
    }
  }

  nitro.hooks.hook('close', async () => {
    // close all running worker processes
    await closeWorker()
    // disconnect all queues
    await disconnectQueues()
    // Will run when nitro is being closed
    logger.info('Closed queue server plugin')
  })
})
