import { defineNitroPlugin } from '#imports'
import { BullMQProvider } from '../queue/adapters/bullmq'
import { setQueueProvider } from '../queue/queueFactory'

export default defineNitroPlugin(async () => {
  const provider = new BullMQProvider()
  await provider.init()
  setQueueProvider(provider)

  return {
    async close() {
      await provider.close()
    },
  }
})
