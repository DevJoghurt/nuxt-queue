import { defineNitroPlugin, $useWorkerHandlers } from '#imports'
import { registerTsWorker } from '../worker/adapter'

export default defineNitroPlugin(async () => {
  try {
    // @ts-ignore - generated at build time
    const handlers = $useWorkerHandlers()
    for (const [queueName, handler] of Object.entries<any>(handlers)) {
      if (typeof handler === 'function') {
        await registerTsWorker(queueName, handler)
      }
    }
  }
  catch {
    // ignore if template not present
  }
})
