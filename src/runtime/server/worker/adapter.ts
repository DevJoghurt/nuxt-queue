import { Worker } from 'bullmq'
import { createBullMQProcessor, type NodeHandler } from './runner/node'
import { useRuntimeConfig, useEventManager } from '#imports'

// Track registered workers AND their handlers
interface QueueWorkerInfo {
  worker: Worker
  handlers: Map<string, NodeHandler> // jobName -> handler
}

const registeredWorkers = new Map<string, QueueWorkerInfo>()

// Close all workers (called on HMR reload or server shutdown)
export async function closeAllWorkers() {
  const closePromises: Promise<void>[] = []
  for (const [queueName, info] of registeredWorkers.entries()) {
    closePromises.push(
      info.worker.close().catch((err) => {
        // Ignore EPIPE and connection errors during close - they're expected during HMR
        if (err.code !== 'EPIPE' && !err.message?.includes('Connection is closed')) {
          console.warn(`[closeAllWorkers] Error closing worker for queue "${queueName}":`, err.message)
        }
      }),
    )
  }
  await Promise.allSettled(closePromises)
  registeredWorkers.clear()

  console.info('[closeAllWorkers] All workers closed')
}

// Register a handler for a specific job on a queue
// Creates ONE Worker per queue that dispatches to handlers by job.name
export async function registerTsWorker(queueName: string, jobName: string, handler: NodeHandler, opts?: any) {
  let info = registeredWorkers.get(queueName)

  if (info) {
    // Worker already exists for this queue - just add the handler

    console.info(`[registerTsWorker] Adding handler for job "${jobName}" to existing worker for queue "${queueName}"`)
    info.handlers.set(jobName, handler)
    return info.worker
  }

  // Create new worker for this queue with a dispatcher

  console.info(`[registerTsWorker] Creating new worker for queue: ${queueName}`)

  const handlers = new Map<string, NodeHandler>()
  handlers.set(jobName, handler)

  // Create a dispatcher that routes to the correct handler based on job.name
  const dispatcher = async (job: any) => {
    const handler = handlers.get(job.name)
    if (!handler) {
      const error = `[Worker] No handler registered for job "${job.name}" on queue "${queueName}". Available handlers: ${Array.from(handlers.keys()).join(', ')}`
      console.error(error)
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
    console.info(`[registerTsWorker] Worker for queue "${queueName}" created but paused (autorun: false)`)
  }
  else {
    console.info(`[registerTsWorker] Worker for queue "${queueName}" created and running`)
  }

  // Add error handler to catch worker-level errors
  worker.on('error', (err) => {
    console.error(`[Worker] Error in worker for queue "${queueName}":`, err)
  })

  worker.on('failed', (job, err) => {
    console.error(`[Worker] Job failed in worker for queue "${queueName}":`, {
      jobId: job?.id,
      jobName: job?.name,
      error: err.message,
      stack: err.stack,
    })

    // Also send as step.failed event if this is a flow job
    // This handles errors that occur outside the handler (e.g., in dispatcher)
    const flowId = job?.data?.flowId
    const flowName = job?.data?.flowName || 'unknown'
    if (flowId) {
      const eventMgr = useEventManager()
      eventMgr.publishBus({
        type: 'step.failed',
        runId: flowId,
        flowName,
        stepName: job.name,
        stepId: `${flowId}__${job.name}__worker-error`,
        data: {
          error: err.message,
          stack: err.stack,
        },
      } as any).catch(() => {
        // ignore if event publish fails
      })
    }
  })

  info = { worker, handlers }
  registeredWorkers.set(queueName, info)

  return worker
}
