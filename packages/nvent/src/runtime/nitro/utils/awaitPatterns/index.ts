import type { AwaitConfig } from '../../../../registry/types'
import { useNventLogger } from '#imports'

// Import all await pattern implementations
import { registerWebhookAwait, resolveWebhookAwait } from './webhook'
import { registerEventAwait, resolveEventAwait } from './event'
import { registerScheduleAwait, resolveScheduleAwait } from './schedule'
import { registerTimeAwait, resolveTimeAwait } from './time'

/**
 * Unified await pattern registry
 * Routes to appropriate await implementation based on type
 */
export async function registerAwaitPattern(
  runId: string,
  stepName: string,
  flowName: string,
  config: AwaitConfig,
  position: 'before' | 'after' = 'after',
) {
  const logger = useNventLogger('await-patterns')

  logger.info(`Registering await pattern: ${config.type}`, {
    runId,
    stepName,
    type: config.type,
  })

  switch (config.type) {
    case 'webhook':
      return await registerWebhookAwait(runId, stepName, flowName, config)

    case 'event':
      return await registerEventAwait(runId, stepName, flowName, config)

    case 'schedule':
      return await registerScheduleAwait(runId, stepName, flowName, config)

    case 'time':
      return await registerTimeAwait(runId, stepName, flowName, config, position)

    default:
      throw new Error(`Unknown await pattern type: ${(config as any).type}`)
  }
}

/**
 * Resolve await pattern by type
 */
export async function resolveAwaitPattern(
  type: 'webhook' | 'event' | 'schedule' | 'time',
  runId: string,
  stepName: string,
  flowName: string,
  position: 'before' | 'after',
  data: any,
) {
  const logger = useNventLogger('await-patterns')

  logger.info(`Resolving await pattern: ${type}`, {
    runId,
    stepName,
    type,
  })

  switch (type) {
    case 'webhook':
      return await resolveWebhookAwait(runId, stepName, data)

    case 'event':
      return await resolveEventAwait(runId, stepName, data)

    case 'schedule':
      return await resolveScheduleAwait(runId, stepName, data)

    case 'time':
      return await resolveTimeAwait(runId, stepName, flowName, position, data)

    default:
      throw new Error(`Unknown await pattern type: ${type}`)
  }
}

// Re-export individual implementations for direct use
export {
  registerWebhookAwait,
  resolveWebhookAwait,
  registerEventAwait,
  resolveEventAwait,
  registerScheduleAwait,
  resolveScheduleAwait,
  registerTimeAwait,
  resolveTimeAwait,
}
