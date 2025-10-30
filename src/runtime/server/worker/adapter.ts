import { Worker } from 'bullmq'
import { createBullMQProcessor, type NodeHandler } from './runner/node'
import { useRuntimeConfig } from '#imports'

// Track registered workers AND their handlers
interface QueueWorkerInfo {
  worker: Worker
  handlers: Map<string, NodeHandler> // jobName -> handler
}

const registeredWorkers = new Map<string, QueueWorkerInfo>()

// Close all workers (called on HMR reload or server shutdown)
export async function closeAllWorkers() {
  const closePromises: Promise<void>[] = []
  for (const [_, info] of registeredWorkers.entries()) {
    closePromises.push(info.worker.close())
  }
  await Promise.all(closePromises)
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
      throw new Error(`[Worker] No handler registered for job "${job.name}" on queue "${queueName}"`)
    }
    const processor = createBullMQProcessor(handler, queueName)
    return processor(job)
  }

  const rc: any = useRuntimeConfig()
  const connection = rc?.queue?.redis
  const worker = new Worker(queueName, dispatcher, { connection, ...(opts || {}) })

  info = { worker, handlers }
  registeredWorkers.set(queueName, info)

  return worker
}
