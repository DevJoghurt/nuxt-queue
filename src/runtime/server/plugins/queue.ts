import { consola } from 'consola'
import { $useQueue, useRuntimeConfig, defineNitroPlugin, $useQueueRegistry } from '#imports'

export default defineNitroPlugin(async (nitro) => {
  const logger = consola.create({}).withTag('QUEUE')

  const { initQueue, initQueueEvent, disconnect: disconnectQueues } = $useQueue()

  // In-process worker registration moved to worker-handlers plugin. Only queue init/close handled here.

  const runtimeQueue: any = (useRuntimeConfig() as any).queue || {}
  const queues = (runtimeQueue.queues || {}) as Record<string, any>
  const registry = $useQueueRegistry() as any
  // workers list retained in runtime config for compatibility but not used here

  /**
   *  Initialize queues
   */
  for (const queueName in queues) {
    const qOpts = queues[queueName]?.options
    initQueue(queueName, qOpts)
    initQueueEvent(queueName, qOpts)
  }

  // Initialize any queues referenced in the compiled registry that aren't in queues map
  if (registry?.workers?.length) {
    for (const w of registry.workers as Array<{ queue: string }>) {
      const qName = w.queue
      if (!queues[qName]) {
        initQueue(qName)
        initQueueEvent(qName)
      }
    }
  }

  /**
   *  Initialize worker
   */
  // Sandboxed workers (legacy) are not auto-registered here anymore.

  nitro.hooks.hook('close', async () => {
    // close all running worker processes
  // legacy worker close no-op (handled by providers/worker-handlers)
    // disconnect all queues
    await disconnectQueues()
    // Will run when nitro is being closed
    logger.info('Closed queue server plugin')
  })
})
