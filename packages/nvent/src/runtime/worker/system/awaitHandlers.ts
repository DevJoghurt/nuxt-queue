/**
 * Internal system handlers for await lifecycle events
 * These handlers run in job context to handle await registration, resolution, and timeout
 */

import { useAwait, useHookRegistry, useNventLogger, $useFunctionRegistry, useEventManager } from '#imports'
import type { QueueJob } from '../node/runner'

const logger = useNventLogger('system-await-handlers')

/**
 * System handler for await registration
 * Registers await pattern and calls onAwaitRegister hook
 */
export async function awaitRegisterHandler(job: QueueJob) {
  const { flowId, flowName, stepName, position, awaitConfig, input } = job.data

  logger.info('Handling await registration', {
    flowId,
    flowName,
    stepName,
    position,
    awaitType: awaitConfig?.type,
  })

  try {
    // Register await pattern
    const { register } = useAwait()
    const awaitResult = await register(
      flowId,
      stepName,
      flowName,
      awaitConfig,
      position,
    )

    logger.info('Registered await pattern', {
      flowId,
      flowName,
      stepName,
      position,
    })

    // Call lifecycle hook if available
    const hookRegistry = useHookRegistry()
    const hooks = hookRegistry.load(flowName, stepName)
    if (hooks?.onAwaitRegister) {
      try {
        // Build hook data based on await type
        let hookData: any = {}
        if (awaitConfig.type === 'webhook' && (awaitResult as any).webhookUrl) {
          hookData = { webhookUrl: (awaitResult as any).webhookUrl }
        }
        else if (awaitConfig.type === 'event' && (awaitResult as any).eventName) {
          hookData = { eventName: (awaitResult as any).eventName }
        }
        else if (awaitConfig.type === 'schedule' && awaitConfig.cron) {
          hookData = {
            cronExpression: awaitConfig.cron,
            nextOccurrence: (awaitResult as any).nextOccurrence || new Date(),
          }
        }
        else if (awaitConfig.type === 'time' && awaitConfig.delay) {
          hookData = { delayMs: awaitConfig.delay }
        }

        // Build minimal context for hook
        const eventManager = useEventManager()
        const hookCtx = {
          flowId,
          flowName,
          stepName,
          awaitType: awaitConfig.type,
          awaitConfig,
          position,
          logger: {
            log: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: any) => {
              void eventManager.publishBus({
                type: 'log',
                runId: flowId,
                flowName,
                stepName,
                data: { level, message: msg, ...meta },
              })
            },
          },
        }

        await hooks.onAwaitRegister(
          hookData,
          input || {},
          hookCtx,
        )

        logger.info('onAwaitRegister hook completed', {
          flowId,
          flowName,
          stepName,
        })
      }
      catch (err) {
        logger.error('onAwaitRegister hook failed', {
          flowId,
          flowName,
          stepName,
          error: (err as Error).message,
        })
        // Continue - hook failure shouldn't fail await registration
      }
    }

    return { success: true, awaitResult }
  }
  catch (err) {
    logger.error('Failed to register await', {
      flowId,
      flowName,
      stepName,
      error: (err as Error).message,
      stack: (err as Error).stack,
    })
    throw err
  }
}

/**
 * System handler for await resolution
 * Calls onAwaitResolve hook and enqueues the actual step (for awaitBefore)
 */
export async function awaitResolveHandler(job: QueueJob) {
  const { flowId, flowName, stepName, position, triggerData, input } = job.data

  logger.info('Handling await resolution', {
    flowId,
    flowName,
    stepName,
    position,
  })

  try {
    // Call lifecycle hook if available
    const hookRegistry = useHookRegistry()
    const hooks = hookRegistry.load(flowName, stepName)
    if (hooks?.onAwaitResolve) {
      try {
        // Get await config to include awaitType in context
        const registry = $useFunctionRegistry() as any
        const flowRegistry = (registry?.flows || {})[flowName]
        const stepMeta = flowRegistry?.steps?.[stepName]
        const awaitConfig = position === 'before' ? stepMeta?.awaitBefore : stepMeta?.awaitAfter

        const eventManager = useEventManager()
        const hookCtx = {
          flowId,
          flowName,
          stepName,
          awaitType: awaitConfig?.type || 'unknown',
          resolvedData: triggerData,
          position,
          logger: {
            log: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: any) => {
              void eventManager.publishBus({
                type: 'log',
                runId: flowId,
                flowName,
                stepName,
                data: { level, message: msg, ...meta },
              })
            },
          },
        }

        await hooks.onAwaitResolve(
          triggerData || {},
          input || {},
          hookCtx,
        )

        logger.info('onAwaitResolve hook completed', {
          flowId,
          flowName,
          stepName,
        })
      }
      catch (err) {
        logger.error('onAwaitResolve hook failed', {
          flowId,
          flowName,
          stepName,
          error: (err as Error).message,
        })
        // Continue - hook failure shouldn't prevent step execution
      }
    }

    // For awaitBefore: step will be enqueued by flow wiring orchestration
    // when it sees the await.resolved event (checkAndTriggerPendingSteps)
    // We don't enqueue here to avoid duplicate enqueueing

    // For awaitAfter: trigger pending steps (handled by flow wiring)

    return { success: true }
  }
  catch (err) {
    logger.error('Failed to handle await resolution', {
      flowId,
      flowName,
      stepName,
      error: (err as Error).message,
      stack: (err as Error).stack,
    })
    throw err
  }
}

/**
 * System handler for await timeout
 * Calls onAwaitTimeout hook
 */
export async function awaitTimeoutHandler(job: QueueJob) {
  const { flowId, flowName, stepName, position, timeoutAction, input } = job.data

  logger.info('Handling await timeout', {
    flowId,
    flowName,
    stepName,
    position,
    timeoutAction,
  })

  try {
    // Call lifecycle hook if available
    const hookRegistry = useHookRegistry()
    const hooks = hookRegistry.load(flowName, stepName)
    if (hooks?.onAwaitTimeout) {
      try {
        // Get await config to include awaitType in context
        const registry = $useFunctionRegistry() as any
        const flowRegistry = (registry?.flows || {})[flowName]
        const stepMeta = flowRegistry?.steps?.[stepName]
        const awaitConfig = position === 'before' ? stepMeta?.awaitBefore : stepMeta?.awaitAfter

        const eventManager = useEventManager()
        const hookCtx = {
          flowId,
          flowName,
          stepName,
          awaitType: awaitConfig?.type || 'unknown',
          timeoutAction: timeoutAction || 'fail',
          position,
          logger: {
            log: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: any) => {
              void eventManager.publishBus({
                type: 'log',
                runId: flowId,
                flowName,
                stepName,
                data: { level, message: msg, ...meta },
              })
            },
          },
        }

        await hooks.onAwaitTimeout(
          input || {},
          hookCtx,
        )

        logger.info('onAwaitTimeout hook completed', {
          flowId,
          flowName,
          stepName,
        })
      }
      catch (err) {
        logger.error('onAwaitTimeout hook failed', {
          flowId,
          flowName,
          stepName,
          error: (err as Error).message,
        })
      }
    }

    return { success: true }
  }
  catch (err) {
    logger.error('Failed to handle await timeout', {
      flowId,
      flowName,
      stepName,
      error: (err as Error).message,
      stack: (err as Error).stack,
    })
    throw err
  }
}
