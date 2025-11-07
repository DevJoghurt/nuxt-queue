import { Worker } from 'bullmq'
import { createBullMQProcessor, type NodeHandler } from './runner/node'
import { useRuntimeConfig, useServerLogger } from '#imports'

// Track registered workers AND their handlers
interface QueueWorkerInfo {
  worker: Worker
  handlers: Map<string, NodeHandler> // jobName -> handler
}

const registeredWorkers = new Map<string, QueueWorkerInfo>()

const logger = useServerLogger('worker-adapter')

// Close all workers (called on HMR reload or server shutdown)
export async function closeAllWorkers() {
  const closePromises: Promise<void>[] = []
  for (const [queueName, info] of registeredWorkers.entries()) {
    closePromises.push(
      info.worker.close().catch((err) => {
        // Ignore EPIPE and connection errors during close - they're expected during HMR
        if (err.code !== 'EPIPE' && !err.message?.includes('Connection is closed')) {
          logger.warn('Error closing worker for queue', { queueName, error: err })
        }
      }),
    )
  }
  await Promise.allSettled(closePromises)
  registeredWorkers.clear()

  logger.info('[closeAllWorkers] All workers closed')
}

// Register a handler for a specific job on a queue
// Creates ONE Worker per queue that dispatches to handlers by job.name
export async function registerTsWorker(queueName: string, jobName: string, handler: NodeHandler, opts?: any) {
  let info = registeredWorkers.get(queueName)

  if (info) {
    // Worker already exists for this queue - just add the handler

    logger.info(`[registerTsWorker] Adding handler for job "${jobName}" to existing worker for queue "${queueName}"`)
    info.handlers.set(jobName, handler)
    return info.worker
  }

  // Create new worker for this queue with a dispatcher

  logger.info(`[registerTsWorker] Creating new worker for queue: ${queueName}`)

  const handlers = new Map<string, NodeHandler>()
  handlers.set(jobName, handler)

  // Create a dispatcher that routes to the correct handler based on job.name
  const dispatcher = async (job: any) => {
    const handler = handlers.get(job.name)
    if (!handler) {
      const error = `[Worker] No handler registered for job "${job.name}" on queue "${queueName}". Available handlers: ${Array.from(handlers.keys()).join(', ')}`
      logger.error(error)
      throw new Error(error)
    }

    const processor = createBullMQProcessor(handler, queueName)
    return processor(job)
  }

  const rc: any = useRuntimeConfig()
  const connection = rc?.queue?.queue?.redis

  // BullMQ Workers start automatically by default
  // If autorun is explicitly false, we need to pause it after creation
  const shouldPause = opts?.autorun === false

  const worker = new Worker(queueName, dispatcher, { connection, ...(opts || {}) })

  // Pause worker if autorun is disabled
  if (shouldPause) {
    await worker.pause()
    logger.info(`[registerTsWorker] Worker for queue "${queueName}" created but paused (autorun: false)`)
  }
  else {
    logger.info(`[registerTsWorker] Worker for queue "${queueName}" created and running`)
  }

  // Add error handler to catch worker-level errors
  worker.on('error', (err) => {
    logger.error(`[Worker] Error in worker for queue "${queueName}":`, err)
  })

  worker.on('failed', (job, err) => {
    logger.error(`[Worker] Job failed in worker for queue "${queueName}":`, {
      jobId: job?.id,
      jobName: job?.name,
      error: err.message,
      stack: err.stack,
    })

    // NOTE: We don't emit step.failed here because the processor in runner/node.ts
    // already handles emitting step.retry or step.failed events based on attempt count.
    // This 'failed' event fires for ALL failures, including retries, so emitting here
    // would create duplicates.
    // Only dispatcher-level errors (no handler found) should reach here without
    // already having events emitted by the processor.
  })

  info = { worker, handlers }
  registeredWorkers.set(queueName, info)

  return worker
}
