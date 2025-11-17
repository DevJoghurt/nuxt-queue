import { defineEventHandler, useRuntimeConfig, $useQueueRegistry, useQueueAdapter, useNventLogger } from '#imports'

const logger = useNventLogger('api-queues-index')

export default defineEventHandler(async () => {
  const rc: any = useRuntimeConfig()
  const registry = $useQueueRegistry() as any

  // Check if adapters are initialized
  let queue: any
  try {
    queue = useQueueAdapter()
  }
  catch (err) {
    logger.error('[queues/index] Adapters not initialized yet:', { error: err })
    return []
  }

  // Get global queue config with defaults from runtime config
  // Structure is rc.nvent.queue (outer is module, inner is queue adapter config)
  const globalQueueConfig = rc?.nvent?.queue || {}
  const globalWorkerDefaults = globalQueueConfig.worker || {}
  const globalQueueDefaults = {
    prefix: globalQueueConfig.prefix,
    defaultJobOptions: globalQueueConfig.defaultJobOptions,
    limiter: globalQueueConfig.limiter,
  }

  const names = new Set<string>()
  if (registry?.workers?.length) {
    for (const w of registry.workers as Array<{ queue: { name: string } }>) names.add(w.queue.name)
  }

  // Fetch counts for each queue
  const queuesWithCounts = await Promise.all(
    Array.from(names).map(async (name) => {
      try {
        const counts = await queue.getJobCounts(name)
        const isPaused = await queue.isPaused(name)

        // Find all workers for this queue from registry
        const workers = registry?.workers?.filter((w: any) => w.queue.name === name) || []

        // Find first worker that has queue/worker config defined
        const workerWithQueueConfig = workers.find((w: any) => w.queue && Object.keys(w.queue).length > 1)
        const workerWithWorkerConfig = workers.find((w: any) => w.worker && Object.keys(w.worker).length > 0)

        const queueConfig = workerWithQueueConfig?.queue || workers[0]?.queue || {}
        const baseWorkerConfig = workerWithWorkerConfig?.worker || {}

        // For multiple workers, show max concurrency across all workers
        const maxConcurrency = workers.reduce((max: number, w: any) => {
          const c = w.worker?.concurrency || 0
          return Math.max(max, c)
        }, baseWorkerConfig.concurrency || 0)

        return {
          name,
          counts,
          isPaused,
          config: {
            queue: {
              // Worker-specific config overrides global defaults
              prefix: queueConfig.prefix || globalQueueDefaults.prefix,
              defaultJobOptions: queueConfig.defaultJobOptions || globalQueueDefaults.defaultJobOptions,
              limiter: queueConfig.limiter || globalQueueDefaults.limiter,
            },
            worker: {
              // Worker-specific config overrides global defaults
              concurrency: maxConcurrency || globalWorkerDefaults.concurrency,
              lockDurationMs: baseWorkerConfig.lockDurationMs || globalWorkerDefaults.lockDurationMs,
              maxStalledCount: baseWorkerConfig.maxStalledCount || globalWorkerDefaults.maxStalledCount,
              drainDelayMs: baseWorkerConfig.drainDelayMs || globalWorkerDefaults.drainDelayMs,
              autorun: baseWorkerConfig.autorun ?? globalWorkerDefaults.autorun,
              pollingIntervalMs: baseWorkerConfig.pollingIntervalMs ?? globalWorkerDefaults.pollingIntervalMs,
            },
          },
        }
      }
      catch (err) {
        logger.error(`Failed to get counts for queue ${name}:`, { error: err })
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
            queue: globalQueueDefaults,
            worker: globalWorkerDefaults,
          },
        }
      }
    }),
  )

  return queuesWithCounts
})
