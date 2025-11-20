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

        // Merge queue configs from all workers on this queue (already merged with defaults in configMerger)
        // Strategy: Collect all unique values across workers, preferring non-default values
        // This ensures step overrides aren't lost when multiple workers share a queue
        const mergedQueueConfig = workers.reduce((acc: any, w: any) => {
          if (!w.queue) return acc

          const result = {
            ...acc,
            name: w.queue.name,
          }

          // Only update prefix/limiter if explicitly different from current
          if (w.queue.prefix && w.queue.prefix !== acc.prefix) {
            result.prefix = w.queue.prefix
          }
          if (w.queue.limiter) {
            result.limiter = w.queue.limiter
          }

          // For defaultJobOptions, deep merge but preserve any existing non-default values
          if (w.queue.defaultJobOptions) {
            result.defaultJobOptions = { ...acc.defaultJobOptions }

            // Merge each property, preferring higher/non-default values
            const wOpts = w.queue.defaultJobOptions
            const accOpts = acc.defaultJobOptions || {}

            // For attempts: use max value (higher attempts = more retries = step override likely)
            if (typeof wOpts.attempts === 'number') {
              result.defaultJobOptions.attempts = Math.max(wOpts.attempts, accOpts.attempts || 0)
            }

            // For backoff: prefer non-default delay values
            if (wOpts.backoff) {
              if (!accOpts.backoff
                || (wOpts.backoff.delay && wOpts.backoff.delay !== globalQueueDefaults.defaultJobOptions?.backoff?.delay)) {
                result.defaultJobOptions.backoff = wOpts.backoff
              }
            }

            // Other options: merge with worker values
            if (typeof wOpts.priority === 'number') result.defaultJobOptions.priority = wOpts.priority
            if (typeof wOpts.timeout === 'number') result.defaultJobOptions.timeout = wOpts.timeout
            if (typeof wOpts.delay === 'number') result.defaultJobOptions.delay = wOpts.delay
            if (typeof wOpts.lifo === 'boolean') result.defaultJobOptions.lifo = wOpts.lifo
            if (wOpts.removeOnComplete !== undefined) result.defaultJobOptions.removeOnComplete = wOpts.removeOnComplete
            if (wOpts.removeOnFail !== undefined) result.defaultJobOptions.removeOnFail = wOpts.removeOnFail
          }

          return result
        }, { ...globalQueueDefaults, name })

        // Merge worker configs from all workers on this queue
        const mergedWorkerConfig = workers.reduce((acc: any, w: any) => {
          if (!w.worker) return acc
          return {
            concurrency: Math.max(acc.concurrency || 0, w.worker.concurrency || 0), // Use max concurrency
            lockDurationMs: w.worker.lockDurationMs ?? acc.lockDurationMs,
            maxStalledCount: w.worker.maxStalledCount ?? acc.maxStalledCount,
            drainDelayMs: w.worker.drainDelayMs ?? acc.drainDelayMs,
            autorun: w.worker.autorun ?? acc.autorun,
            pollingIntervalMs: w.worker.pollingIntervalMs ?? acc.pollingIntervalMs,
          }
        }, { ...globalWorkerDefaults })

        return {
          name,
          counts,
          isPaused,
          config: {
            queue: mergedQueueConfig,
            worker: mergedWorkerConfig,
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
