import { defineNitroPlugin, $useWorkerHandlers, $useFunctionRegistry, useQueueAdapter, useHookRegistry } from '#imports'
import type { NodeHandler } from '../../worker/node/runner'
import { createJobProcessor } from '../../worker/node/runner'
import { registerSystemHandlersOnQueue } from '../../worker/system'

type HandlerEntry = { queue: string, id: string, absPath: string, handler: NodeHandler, module?: any }

export default defineNitroPlugin(async (nitroApp) => {
  // Close all workers on shutdown or HMR reload
  nitroApp.hooks.hook('close', async () => {
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
      const registry = ($useFunctionRegistry() as any) || { workers: [] }

      // Track which queues have handlers registered
      const registeredQueues = new Set<string>()
      // Track which queues have hooks (need system handlers)
      const queuesWithHooks = new Set<string>()

      for (const entry of handlers) {
        const { queue, id, handler, module } = entry as any

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

        // Extract lifecycle hooks if present (v0.5 await integration)
        if (module) {
          const hooks: any = {}
          if (typeof module.onAwaitRegister === 'function') {
            hooks.onAwaitRegister = module.onAwaitRegister
          }
          if (typeof module.onAwaitResolve === 'function') {
            hooks.onAwaitResolve = module.onAwaitResolve
          }
          if (typeof module.onAwaitTimeout === 'function') {
            hooks.onAwaitTimeout = module.onAwaitTimeout
          }

          // Register hooks if any exist (only for flow workers)
          if (Object.keys(hooks).length > 0 && w?.flow) {
            const hookRegistry = useHookRegistry()

            // Handle both singular 'name' and plural 'names' (normalized by registry)
            const flowNames = w.flow.names
              ? (Array.isArray(w.flow.names) ? w.flow.names : [w.flow.names])
              : (w.flow.name ? (Array.isArray(w.flow.name) ? w.flow.name : [w.flow.name]) : [])

            for (const flowName of flowNames) {
              if (flowName) {
                hookRegistry.register(flowName, jobName, hooks)
              }
            }

            // Mark this queue as having hooks (needs system handlers)
            queuesWithHooks.add(queue)
          }

          // Check if worker has await configuration (needs system handlers even without hooks)
          if (w?.flow?.awaitBefore || w?.flow?.awaitAfter) {
            queuesWithHooks.add(queue)
          }

          // Also check entry step for await configuration
          if (w?.flow?.role === 'entry') {
            const flowNames = w.flow.names
              ? (Array.isArray(w.flow.names) ? w.flow.names : [w.flow.names])
              : (w.flow.name ? (Array.isArray(w.flow.name) ? w.flow.name : [w.flow.name]) : [])

            for (const flowName of flowNames) {
              const flowRegistry = (registry?.flows || {})[flowName]
              if (flowRegistry?.entry?.awaitBefore || flowRegistry?.entry?.awaitAfter) {
                queuesWithHooks.add(queue)
                break
              }
            }
          }
        }

        if (typeof handler === 'function') {
          const workerCfg = (w && w.worker) || {}
          const queueCfg = (w && w.queue) || {}

          // Map generic WorkerConfig -> adapter-agnostic options
          // Priority: step config > nuxt.config (already merged in configMerger)
          const opts: any = {}

          // Worker options
          if (typeof workerCfg.concurrency === 'number') opts.concurrency = workerCfg.concurrency
          if (typeof workerCfg.autorun === 'boolean') opts.autorun = workerCfg.autorun
          // Note: lockDurationMs, maxStalledCount, drainDelayMs are BullMQ-specific
          // and should be handled by the BullMQ adapter implementation if needed

          // Queue options (for job defaults) - pass to adapter
          if (queueCfg.defaultJobOptions) opts.defaultJobOptions = queueCfg.defaultJobOptions
          if (queueCfg.prefix) opts.prefix = queueCfg.prefix
          if (queueCfg.limiter) opts.limiter = queueCfg.limiter

          // Wrap the raw NodeHandler with the processor that builds RunContext
          const processor = createJobProcessor(handler, queue)

          // Register worker through the adapter
          queueAdapter.registerWorker(queue, jobName, processor as any, opts)
          registeredQueues.add(queue)
        }
      }

      // Register system handlers on queues that have hooks
      for (const queueName of queuesWithHooks) {
        try {
          // Use the queue's concurrency setting for system handlers
          const queueWorker = (registry.workers as any[]).find((w: any) => w?.queue?.name === queueName)
          const concurrency = queueWorker?.worker?.concurrency

          registerSystemHandlersOnQueue(queueName, concurrency)

          // Ensure this queue is marked as registered so it gets started
          registeredQueues.add(queueName)
        }
        catch (err) {
          console.error(`[nvent] Failed to register system handlers on queue ${queueName}:`, err)
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
})
