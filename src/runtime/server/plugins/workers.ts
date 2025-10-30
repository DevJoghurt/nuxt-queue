import { defineNitroPlugin, $useWorkerHandlers, $useQueueRegistry } from '#imports'
import { registerTsWorker, closeAllWorkers } from '../worker/adapter'
import type { NodeHandler } from '../worker/runner/node'

type HandlerEntry = { queue: string, id: string, absPath: string, handler: NodeHandler }

export default defineNitroPlugin(async (nitroApp) => {
  // Close all workers on shutdown or HMR reload
  nitroApp.hooks.hook('close', async () => {
    await closeAllWorkers()
  })

  try {
    // @ts-ignore - generated at build time
    const handlers = $useWorkerHandlers() as ReadonlyArray<HandlerEntry>
    const registry = ($useQueueRegistry() as any) || { workers: [] }
    for (const entry of handlers) {
      const { queue, id, handler } = entry as any
      // Extract job name from the worker id (e.g., "example/first_step" -> "first_step")
      const jobName = id.includes('/') ? id.split('/').pop() : id
      if (typeof handler === 'function') {
        // Match exact worker by id; fallback to queue + absPath if needed
        const w = (registry.workers as any[]).find(rw => (rw?.id === id) || (rw?.queue === queue && rw?.absPath === entry.absPath))
        const cfg = (w && w.worker) || {}
        // Map generic WorkerConfig -> provider-specific options (BullMQ currently)
        const opts: any = {}
        if (typeof cfg.concurrency === 'number') opts.concurrency = cfg.concurrency
        if (typeof cfg.lockDurationMs === 'number') opts.lockDuration = cfg.lockDurationMs
        if (typeof cfg.maxStalledCount === 'number') opts.maxStalledCount = cfg.maxStalledCount
        if (typeof cfg.drainDelayMs === 'number') opts.drainDelay = cfg.drainDelayMs
        if (typeof cfg.autorun === 'boolean') opts.autorun = cfg.autorun
        await registerTsWorker(queue, jobName, handler as any, opts)
      }
    }
  }
  catch {
    // ignore if template not present
  }
})
