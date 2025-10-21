import { defineNitroPlugin } from '#imports'
import { BullMQProvider } from '../providers/queue/bullmq'
import { setQueueProvider } from '../providers/queue/index'

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
