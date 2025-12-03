import type { AwaitConfig } from '../../../../registry/types'
import { useNventLogger, useRuntimeConfig, useScheduler } from '#imports'
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
  position: 'before' | 'after' = 'after',
) {
  const logger = useNventLogger('await-webhook')
  const eventBus = getEventBus()
  const runtimeConfig = useRuntimeConfig()

  // Auto-generate webhook path from flow context
  const path = `/${flowName}/${runId}/${stepName}`

  // Get base URL from config or Nitro context
  let baseUrl = (runtimeConfig.nvent as any)?.webhooks?.baseUrl

  // If not explicitly configured, try to get from Nitro's runtime config
  if (!baseUrl) {
    // In development, Nitro exposes the dev server URL
    const nitroApp = (runtimeConfig as any).nitro?.app
    if (nitroApp?.baseURL) {
      // Construct from Nitro's URL (protocol + host)
      baseUrl = `${nitroApp.baseURL}`
    }
    // Fallback: try common environment variables
    if (!baseUrl) {
      baseUrl = process.env.NITRO_URL
        || process.env.URL
        || (process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : undefined)
    }
  }

  if (!baseUrl) {
    logger.warn('No baseUrl configured for webhooks. Set NUXT_PUBLIC_SITE_URL or nvent.webhooks.baseUrl')
    baseUrl = 'http://localhost:3000' // Ultimate fallback
  }

  const webhookPath = `/api/_webhook/await${path}`
  const fullWebhookUrl = `${baseUrl.replace(/\/$/, '')}${webhookPath}`

  logger.info(`Registering webhook await: ${fullWebhookUrl}`, { runId, stepName })

  // Emit await.registered event (wiring will handle flow state updates)
  eventBus.publish({
    type: 'await.registered',
    flowName,
    runId,
    stepName,
    awaitType: 'webhook',
    position,
    config,
    data: {
      path,
      method: config.method || 'POST',
      timeout: config.timeout,
      registeredAt: Date.now(),
      webhookUrl: fullWebhookUrl,
    },
  })

  // Schedule timeout if configured
  if (config.timeout && config.timeout > 0) {
    const scheduler = useScheduler()
    const timeoutAt = Date.now() + config.timeout
    const jobId = `await-webhook-timeout-${runId}-${stepName}-${position}`

    await scheduler.schedule({
      id: jobId,
      name: `Webhook Timeout: ${flowName} - ${stepName}`,
      type: 'one-time',
      executeAt: timeoutAt,
      handler: async () => {
        logger.warn('Webhook await timeout', {
          runId,
          stepName,
          flowName,
          timeout: config.timeout,
          timeoutAction: config.timeoutAction || 'fail',
        })

        // Emit timeout event
        eventBus.publish({
          type: 'await.timeout',
          flowName,
          runId,
          stepName,
          position,
          awaitType: 'webhook',
          timeoutAction: config.timeoutAction || 'fail',
          data: {
            timeout: config.timeout,
            registeredAt: Date.now() - (config.timeout || 0),
            timedOutAt: Date.now(),
          },
        } as any)
      },
      metadata: {
        component: 'await-pattern',
        awaitType: 'webhook',
        runId,
        stepName,
        flowName,
        position,
        timeout: config.timeout,
      },
    })

    logger.debug(`Webhook timeout scheduled`, {
      runId,
      stepName,
      timeout: config.timeout,
      timeoutAction: config.timeoutAction,
    })
  }

  logger.debug(`Webhook await registered: ${fullWebhookUrl}`, { runId, stepName })

  return {
    webhookUrl: fullWebhookUrl,
    timeout: config.timeout,
  }
}

/**
 * Resolve webhook await when webhook is called
 */
export async function resolveWebhookAwait(
  runId: string,
  stepName: string,
  flowName: string,
  position: 'before' | 'after',
  webhookData: any,
) {
  const logger = useNventLogger('await-webhook')
  const eventBus = getEventBus()
  const scheduler = useScheduler()

  logger.info(`Resolving webhook await`, { runId, stepName })

  // Unschedule timeout job if exists
  const jobId = `await-webhook-timeout-${runId}-${stepName}-${position}`
  try {
    await scheduler.unschedule(jobId)
    logger.debug('Unscheduled webhook timeout job', { runId, stepName, jobId })
  }
  catch {
    // Job might not exist or already executed, that's fine
    logger.debug('Could not unschedule timeout job (may not exist)', { runId, stepName, jobId })
  }

  // Emit await.resolved event (wiring will handle flow state updates and processing)
  eventBus.publish({
    type: 'await.resolved',
    flowName,
    runId,
    stepName,
    position,
    triggerData: webhookData,
    data: {
      resolvedAt: Date.now(),
    },
  } as any)

  logger.debug(`Webhook await resolved`, { runId, stepName })
}
