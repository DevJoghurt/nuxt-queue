import type { AwaitConfig } from '../../../../registry/types'
import { useNventLogger, useStoreAdapter, useStreamTopics } from '#imports'
import { getEventBus } from '../../../events/eventBus'

/**
 * Await Pattern: Webhook
 *
 * Creates a dynamic webhook endpoint that resolves when called
 * Useful for human approval flows, external integrations
 */
export async function registerWebhookAwait(
  runId: string,
  stepName: string,
  flowName: string,
  config: AwaitConfig,
) {
  const logger = useNventLogger('await-webhook')
  const store = useStoreAdapter()
  const eventBus = getEventBus()
  const { SubjectPatterns } = useStreamTopics()

  // Replace variables in path
  const path = config.path
    ?.replace('{runId}', runId)
    ?.replace('{stepName}', stepName)
    ?.replace('{flowName}', flowName)

  if (!path) {
    throw new Error('Webhook await requires path configuration')
  }

  logger.info(`Registering webhook await: ${path}`, { runId, stepName })

  // Store webhook route mapping in KV for fast lookup
  if (store.kv?.set) {
    const routeKey = SubjectPatterns.webhookRoute(path)
    await store.kv.set(
      routeKey,
      {
        runId,
        stepName,
        flowName,
        method: config.method || 'POST',
        registeredAt: Date.now(),
      },
      config.timeout ? Math.floor(config.timeout / 1000) : undefined,
    )
  }

  // Emit await.registered event
  eventBus.publish({
    type: 'await.registered',
    flowName,
    runId,
    stepName,
    data: {
      awaitType: 'webhook',
      path,
      method: config.method || 'POST',
      timeout: config.timeout,
    },
  } as any)

  logger.debug(`Webhook await registered: ${path}`, { runId, stepName })

  return {
    webhookUrl: path,
    timeout: config.timeout,
  }
}

/**
 * Resolve webhook await when webhook is called
 */
export async function resolveWebhookAwait(
  runId: string,
  stepName: string,
  webhookData: any,
) {
  const logger = useNventLogger('await-webhook')
  const eventBus = getEventBus()
  const store = useStoreAdapter()
  const { SubjectPatterns } = useStreamTopics()

  logger.info(`Resolving webhook await`, { runId, stepName })

  // Get flow name from index
  const flowName = runId.split('-')[0]

  // Emit await.resolved event
  eventBus.publish({
    type: 'await.resolved',
    flowName,
    runId,
    stepName,
    data: {
      triggerData: webhookData,
      resolvedAt: Date.now(),
    },
  } as any)

  // Clean up KV entries
  if (store.kv?.delete) {
    const statusKey = SubjectPatterns.awaitStatus(runId, stepName)
    await store.kv.delete(statusKey)
  }

  logger.debug(`Webhook await resolved`, { runId, stepName })
}
