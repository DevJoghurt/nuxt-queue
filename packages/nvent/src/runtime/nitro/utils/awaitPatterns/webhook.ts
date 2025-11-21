import type { AwaitConfig } from '../../../../registry/types'
import { useNventLogger, useRuntimeConfig } from '#imports'
import { getEventBus } from '../../../events/eventBus'

// Track active timeouts for webhook awaits
const activeTimeouts = new Map<string, NodeJS.Timeout>()

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
    const timeoutKey = `${runId}:${stepName}`

    // Clear any existing timeout for this await
    const existingTimeout = activeTimeouts.get(timeoutKey)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
    }

    const timeoutId = setTimeout(() => {
      logger.warn('Webhook await timeout', {
        runId,
        stepName,
        flowName,
        timeout: config.timeout,
        timeoutAction: config.timeoutAction || 'fail',
      })

      // Remove from active timeouts
      activeTimeouts.delete(timeoutKey)

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
    }, config.timeout)

    activeTimeouts.set(timeoutKey, timeoutId)

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

  logger.info(`Resolving webhook await`, { runId, stepName })

  // Clear timeout if exists
  const timeoutKey = `${runId}:${stepName}`
  const existingTimeout = activeTimeouts.get(timeoutKey)
  if (existingTimeout) {
    clearTimeout(existingTimeout)
    activeTimeouts.delete(timeoutKey)
    logger.debug('Cleared webhook timeout', { runId, stepName })
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
