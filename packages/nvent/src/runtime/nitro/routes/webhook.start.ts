import { defineEventHandler, readBody } from 'h3'
import { useNventLogger, useTrigger } from '#imports'

/**
 * Dynamic webhook trigger handler for entry triggers (flow-scoped)
 * Receives webhook calls and fires triggers to start flows
 *
 * Routes:
 * - POST /api/nvent/trigger/{triggerName}
 * - GET /api/nvent/trigger/{triggerName}
 *
 * Different from await webhooks:
 * - Entry triggers are flow-scoped (start new flow runs)
 * - Await webhooks are run-scoped (resume specific steps)
 */
export default defineEventHandler(async (event) => {
  const logger = useNventLogger('webhook-trigger')
  const trigger = useTrigger()

  // Get trigger name from path
  const triggerName = event.path.replace('/api/nvent/trigger/', '')

  logger.info(`Webhook trigger received: ${event.method} ${triggerName}`)

  // Check if trigger exists
  const triggerEntry = trigger.getTrigger(triggerName)

  if (!triggerEntry) {
    logger.warn(`Trigger not found: ${triggerName}`)
    return {
      error: 'Trigger not found',
      triggerName,
      message: `No trigger registered with name '${triggerName}'`,
    }
  }

  // Verify this is a webhook trigger
  if (triggerEntry.type !== 'webhook') {
    logger.warn(`Trigger is not a webhook: ${triggerName} (type: ${triggerEntry.type})`)
    return {
      error: 'Invalid trigger type',
      triggerName,
      expectedType: 'webhook',
      actualType: triggerEntry.type,
    }
  }

  // Verify method matches
  const expectedMethod = triggerEntry.webhook?.method || 'POST'
  if (event.method !== expectedMethod) {
    logger.warn(`Method mismatch: expected ${expectedMethod}, got ${event.method}`)
    return {
      error: 'Method not allowed',
      expectedMethod,
      actualMethod: event.method,
    }
  }

  // Get webhook payload
  let webhookData: any
  if (event.method === 'GET') {
    // For GET requests, use query parameters
    webhookData = event.context.params || {}
  }
  else {
    webhookData = await readBody(event)
  }

  logger.debug(`Webhook data received`, {
    triggerName,
    dataKeys: Object.keys(webhookData || {}),
  })

  // TODO: Verify authentication if configured
  // if (triggerEntry.webhook?.auth) {
  //   const authResult = await verifyWebhookAuth(event, triggerEntry.webhook.auth)
  //   if (!authResult.valid) {
  //     return { error: 'Authentication failed', reason: authResult.reason }
  //   }
  // }

  // TODO: Validate against schema if provided
  // if (triggerEntry.webhook?.schema) {
  //   const schema = eval(triggerEntry.webhook.schema)
  //   const result = schema.safeParse(webhookData)
  //   if (!result.success) {
  //     return { error: 'Validation failed', errors: result.error.errors }
  //   }
  // }

  // TODO: Apply transform if configured
  // if (triggerEntry.webhook?.transform) {
  //   const transformFn = eval(triggerEntry.webhook.transform)
  //   webhookData = transformFn(webhookData)
  // }

  // Emit the trigger (will start subscribed flows)
  await trigger.emitTrigger(triggerName, webhookData)

  logger.info(`Webhook trigger fired`, {
    triggerName,
    subscribedFlows: trigger.getSubscribedFlows(triggerName).length,
  })

  return {
    success: true,
    triggerName,
    subscribedFlows: trigger.getSubscribedFlows(triggerName),
    message: 'Trigger fired successfully',
    timestamp: new Date().toISOString(),
  }
})
