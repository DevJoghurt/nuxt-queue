import { defineEventHandler, readBody, getRouterParam, createError, setResponseStatus } from 'h3'
import { useStoreAdapter, useStreamTopics, useNventLogger, useAwait } from '#imports'

/**
 * Dynamic webhook handler for await patterns
 * Handles webhook calls and resolves awaiting steps
 *
 * Routes:
 * - POST /api/_webhook/await/{path...}
 * - GET /api/_webhook/await/{path...}
 *
 * Architecture:
 * 1. Lookup webhook route in KV (fast lookup, no flow scan needed)
 * 2. Verify flow is still awaiting (not completed/canceled/stalled)
 * 3. Use useAwait().webhook.resolve() which publishes await.resolved event
 * 4. Trigger wiring handles the actual flow resumption
 */
export default defineEventHandler(async (event) => {
  const logger = useNventLogger('webhook-handler')
  const store = useStoreAdapter()
  const await$ = useAwait()
  const { SubjectPatterns } = useStreamTopics()

  // Get the full path after /api/_webhook/await/
  const path = event.path.replace('/api/_webhook/await/', '')

  logger.info(`Webhook received: ${event.method} /${path}`)

  // Look up webhook registration in KV (registered by await pattern)
  const routeKey = SubjectPatterns.webhookRoute(`/${path}`)
  const registration = await store.kv?.get<any>(routeKey)

  if (!registration) {
    logger.warn(`Webhook not found or expired: /${path}`)
    setResponseStatus(event, 410) // Gone
    throw createError({
      statusCode: 410,
      statusMessage: 'Webhook not found or has expired',
      message: 'The webhook may have been cleaned up because the flow completed, was canceled, or timed out.',
    })
  }

  const { runId, stepName, flowName, method } = registration

  // Verify method matches
  if (event.method !== method) {
    logger.warn(`Method mismatch: expected ${method}, got ${event.method}`, { runId, stepName })
    throw createError({
      statusCode: 405,
      statusMessage: 'Method Not Allowed',
      message: `This webhook expects ${method} requests.`,
    })
  }

  // Verify flow is still awaiting (double-check before processing)
  if (store.indexGet) {
    const indexKey = SubjectPatterns.flowRunIndex(flowName)
    const flowEntry = await store.indexGet(indexKey, runId)

    if (!flowEntry) {
      logger.warn(`Flow not found`, { runId, stepName })
      setResponseStatus(event, 404)
      throw createError({
        statusCode: 404,
        statusMessage: 'Flow not found',
        message: 'The flow associated with this webhook no longer exists.',
      })
    }

    const status = flowEntry.metadata?.status
    if (status && status !== 'running') {
      logger.warn(`Flow is not running`, { runId, stepName, status })
      setResponseStatus(event, 410)
      throw createError({
        statusCode: 410,
        statusMessage: `Flow is ${status}`,
        message: `This webhook is no longer valid because the flow is ${status}.`,
      })
    }

    const awaitState = flowEntry.metadata?.awaitingSteps?.[stepName]
    if (!awaitState) {
      logger.warn(`Step is not awaiting`, { runId, stepName })
      setResponseStatus(event, 410)
      throw createError({
        statusCode: 410,
        statusMessage: 'Step is not awaiting',
        message: 'This webhook has already been called or the await has expired.',
      })
    }
  }

  // Get webhook payload
  let webhookData: any
  if (event.method === 'GET') {
    webhookData = getRouterParam(event, 'query') || {}
  }
  else {
    webhookData = await readBody(event).catch(() => ({}))
  }

  logger.debug(`Webhook data received`, {
    runId,
    stepName,
    dataKeys: Object.keys(webhookData || {}),
  })

  // TODO: Schema validation
  // if (registration.schema) {
  //   const schema = eval(registration.schema)
  //   const result = schema.safeParse(webhookData)
  //   if (!result.success) {
  //     throw createError({
  //       statusCode: 400,
  //       statusMessage: 'Validation Failed',
  //       data: result.error.errors,
  //     })
  //   }
  // }

  // Resolve the await using event-driven pattern
  // This publishes await.resolved event, trigger wiring handles the rest
  await await$.webhook.resolve(runId, stepName, webhookData)

  logger.info(`Webhook await resolved`, { runId, stepName })

  return {
    success: true,
    runId,
    stepName,
    flowName,
    message: 'Webhook processed successfully. Flow will resume shortly.',
  }
})
