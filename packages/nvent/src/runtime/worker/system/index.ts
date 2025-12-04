/**
 * System handlers for await lifecycle events
 * These handlers are registered on each queue that has workers with lifecycle hooks
 */

import { useQueueAdapter, useRuntimeConfig, useNventLogger } from '#imports'
import { awaitRegisterHandler, awaitResolveHandler, awaitTimeoutHandler } from './awaitHandlers'

const logger = useNventLogger('system-workers')

/**
 * System handler names
 * These handlers run in the same queue as the step that has hooks
 */
export const SYSTEM_HANDLERS = {
  AWAIT_REGISTER: '__nvent_await_register',
  AWAIT_RESOLVE: '__nvent_await_resolve',
  AWAIT_TIMEOUT: '__nvent_await_timeout',
} as const

/**
 * Register system handlers on a specific queue
 * Allows await lifecycle hooks to run in the same queue as the step
 */
export function registerSystemHandlersOnQueue(queueName: string, concurrency?: number) {
  try {
    const queue = useQueueAdapter()
    const config: any = useRuntimeConfig()

    // Get concurrency settings (use queue's default if not specified)
    const handlerConcurrency = concurrency || config?.nvent?.queue?.systemConcurrency || 5

    logger.debug('Registering system handlers on queue', {
      queue: queueName,
      concurrency: handlerConcurrency,
      handlers: Object.values(SYSTEM_HANDLERS),
    })

    // System handlers receive raw jobs without createJobProcessor wrapper
    // They access job.data directly for their specific payload structure

    // Register await registration handler
    queue.registerWorker(queueName, SYSTEM_HANDLERS.AWAIT_REGISTER, awaitRegisterHandler as any, {
      concurrency: handlerConcurrency,
    })

    // Register await resolution handler
    queue.registerWorker(queueName, SYSTEM_HANDLERS.AWAIT_RESOLVE, awaitResolveHandler as any, {
      concurrency: handlerConcurrency,
    })

    // Register await timeout handler
    queue.registerWorker(queueName, SYSTEM_HANDLERS.AWAIT_TIMEOUT, awaitTimeoutHandler as any, {
      concurrency: handlerConcurrency,
    })
  }
  catch (err) {
    logger.error('Failed to register system handlers on queue', {
      queue: queueName,
      error: (err as Error).message,
      stack: (err as Error).stack,
    })
    throw err
  }
}

/**
 * Initialize system workers
 * Registers internal handlers with the queue adapter
 * @deprecated System handlers are now registered on each step's queue
 */
export async function initializeSystemWorkers() {
  logger.info('System workers module loaded (handlers registered per-queue)')
}
