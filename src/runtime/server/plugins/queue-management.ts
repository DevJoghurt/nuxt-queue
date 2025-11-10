import { defineNitroPlugin, useServerLogger } from '#imports'
import { BullMQProvider } from '../../server-utils/queue/adapters/bullmq'
import { setQueueProvider, getQueueProvider } from '../../server-utils/queue/queueFactory'

const logger = useServerLogger('plugin-queue-management')

export default defineNitroPlugin(async (nitroApp) => {
  // Close existing provider if any (handles HMR reload)
  try {
    const existingProvider = getQueueProvider()
    if (existingProvider) {
      logger.info('[queues plugin] Closing existing queue provider before creating new one...')
      await existingProvider.close()
      // Small delay to ensure connections are fully closed
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  catch {
    // No existing provider, continue
  }

  const provider = new BullMQProvider()
  await provider.init()
  setQueueProvider(provider)

  // Hook into Nitro's close event for proper cleanup
  nitroApp.hooks.hook('close', async () => {
    logger.info('[queues plugin] Closing queue provider...')
    await provider.close()
  })

  return {
    async close() {
      await provider.close()
    },
  }
})
