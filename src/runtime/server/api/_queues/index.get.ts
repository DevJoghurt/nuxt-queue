import { defineEventHandler, useRuntimeConfig, $useQueueRegistry, useQueue } from '#imports'

export default defineEventHandler(async () => {
  const rc: any = useRuntimeConfig()
  const cfgQueues = (rc?.queue?.queues || {}) as Record<string, any>
  const registry = $useQueueRegistry() as any
  const queue = useQueue()

  const names = new Set<string>()
  for (const q in cfgQueues) names.add(q)
  if (registry?.workers?.length) {
    for (const w of registry.workers as Array<{ queue: { name: string } }>) names.add(w.queue.name)
  }

  // Fetch counts for each queue
  const queuesWithCounts = await Promise.all(
    Array.from(names).map(async (name) => {
      try {
        const counts = await queue.getJobCounts(name)
        const isPaused = await queue.isPaused(name)

        // Find worker config for this queue from registry
        const worker = registry?.workers?.find((w: any) => w.queue.name === name)
        const queueConfig = worker?.queue || {}
        const workerConfig = worker?.worker || {}

        return {
          name,
          counts,
          isPaused,
          config: {
            queue: {
              prefix: queueConfig.prefix,
              defaultJobOptions: queueConfig.defaultJobOptions,
              limiter: queueConfig.limiter,
            },
            worker: {
              concurrency: workerConfig.concurrency,
              lockDurationMs: workerConfig.lockDurationMs,
              maxStalledCount: workerConfig.maxStalledCount,
              drainDelayMs: workerConfig.drainDelayMs,
              autorun: workerConfig.autorun,
              pollingIntervalMs: workerConfig.pollingIntervalMs,
            },
          },
        }
      }
      catch (err) {
        console.error(`Failed to get counts for queue ${name}:`, err)
        return {
          name,
          counts: {
            active: 0,
            completed: 0,
            failed: 0,
            delayed: 0,
            waiting: 0,
            paused: 0,
          },
          isPaused: false,
          config: {
            queue: {},
            worker: {},
          },
        }
      }
    }),
  )

  return queuesWithCounts
})
