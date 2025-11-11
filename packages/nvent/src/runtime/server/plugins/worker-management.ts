<<<<<<< HEAD
import { defineNitroPlugin, $useWorkerHandlers, $useQueueRegistry, useQueueAdapter } from '#imports'
import type { NodeHandler } from '../worker/runner/node'
import { createJobProcessor } from '../worker/runner/node'
=======
import { defineNitroPlugin, $useWorkerHandlers, $useQueueRegistry } from '#imports'
import { registerTsWorker, closeAllWorkers } from '../../server-utils/worker/adapter'
import type { NodeHandler } from '../../server-utils/worker/runner/node'
>>>>>>> 227da8b (refactoring)

type HandlerEntry = { queue: string, id: string, absPath: string, handler: NodeHandler }

export default defineNitroPlugin(async (nitroApp) => {
  // Close all workers on shutdown or HMR reload
  nitroApp.hooks.hook('close', async () => {
<<<<<<< HEAD
    const queueAdapter = useQueueAdapter()
    await queueAdapter.close()
  })

  // Wait for adapters to be ready before registering workers
  // This hook is called by 00.adapters.ts after initialization completes
  nitroApp.hooks.hook('nvent:adapters:ready' as any, async () => {
    const queueAdapter = useQueueAdapter()

    try {
      // @ts-ignore - generated at build time
      const handlers = $useWorkerHandlers() as ReadonlyArray<HandlerEntry>
      const registry = ($useQueueRegistry() as any) || { workers: [] }

      // Track which queues have handlers registered
      const registeredQueues = new Set<string>()

      for (const entry of handlers) {
        const { queue, id, handler } = entry as any

        // Match exact worker by id; fallback to queue + absPath if needed
        const w = (registry.workers as any[]).find(rw => (rw?.id === id) || (rw?.queue?.name === queue && rw?.absPath === entry.absPath))

        // Determine job name: use flow.step from config if available, otherwise extract from id
        let jobName: string
        if (w?.flow?.step) {
          // Config has higher priority - use the step name from flow config
          jobName = Array.isArray(w.flow.step) ? w.flow.step[0] : w.flow.step
        }
        else {
          // Fallback: extract from worker id (e.g., "example/first_step" -> "first_step")
          jobName = id.includes('/') ? id.split('/').pop() : id
        }

        if (typeof handler === 'function') {
          const cfg = (w && w.worker) || {}
          // Map generic WorkerConfig -> adapter-agnostic options
          const opts: any = {}
          if (typeof cfg.concurrency === 'number') opts.concurrency = cfg.concurrency
          if (typeof cfg.autorun === 'boolean') opts.autorun = cfg.autorun
          // Note: lockDurationMs, maxStalledCount, drainDelayMs are BullMQ-specific
          // and should be handled by the BullMQ adapter implementation if needed

          // Wrap the raw NodeHandler with the processor that builds RunContext
          const processor = createJobProcessor(handler, queue)

          // Register worker through the adapter
          queueAdapter.registerWorker(queue, jobName, processor as any, opts)
          registeredQueues.add(queue)
        }
      }

      // After all handlers are registered, start processing waiting jobs for each queue
      if (queueAdapter.startProcessingQueue) {
        for (const queueName of Array.from(registeredQueues)) {
          queueAdapter.startProcessingQueue(queueName)
        }
      }
    }
    catch {
      // ignore if template not present
    }
  })
=======
    await closeAllWorkers()
  })

  try {
    // @ts-ignore - generated at build time
    const handlers = $useWorkerHandlers() as ReadonlyArray<HandlerEntry>
    const registry = ($useQueueRegistry() as any) || { workers: [] }
    for (const entry of handlers) {
      const { queue, id, handler } = entry as any

      // Match exact worker by id; fallback to queue + absPath if needed
      const w = (registry.workers as any[]).find(rw => (rw?.id === id) || (rw?.queue?.name === queue && rw?.absPath === entry.absPath))

      // Determine job name: use flow.step from config if available, otherwise extract from id
      let jobName: string
      if (w?.flow?.step) {
        // Config has higher priority - use the step name from flow config
        jobName = Array.isArray(w.flow.step) ? w.flow.step[0] : w.flow.step
      }
      else {
        // Fallback: extract from worker id (e.g., "example/first_step" -> "first_step")
        jobName = id.includes('/') ? id.split('/').pop() : id
      }

      if (typeof handler === 'function') {
        const cfg = (w && w.worker) || {}
        // Map generic WorkerConfig -> provider-specific options (BullMQ currently)
        const opts: any = {}
        if (typeof cfg.concurrency === 'number') opts.concurrency = cfg.concurrency
        if (typeof cfg.lockDurationMs === 'number') opts.lockDuration = cfg.lockDurationMs
        if (typeof cfg.maxStalledCount === 'number') opts.maxStalledCount = cfg.maxStalledCount
        if (typeof cfg.drainDelayMs === 'number') opts.drainDelay = cfg.drainDelayMs
        if (typeof cfg.autorun === 'boolean') opts.autorun = cfg.autorun
        // Include prefix from queue config so Worker and Queue use the same Redis keys
        if (w?.queue?.prefix) opts.prefix = w.queue.prefix
        // Note: pollingIntervalMs is not directly supported by BullMQ (uses blocking wait)
        // but we keep it in WorkerConfig for future PGBoss compatibility
        await registerTsWorker(queue, jobName, handler as any, opts)
      }
    }
  }
  catch {
    // ignore if template not present
  }
>>>>>>> 227da8b (refactoring)
})
