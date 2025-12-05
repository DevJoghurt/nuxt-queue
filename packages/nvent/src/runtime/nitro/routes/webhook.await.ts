import { defineEventHandler, readBody, getRouterParams, createError, setResponseStatus } from 'h3'
import { useStoreAdapter, useStreamTopics, useNventLogger, useAwait } from '#imports'

/**
 * Dynamic webhook handler for await patterns
 * Handles webhook calls and resolves awaiting steps
 *
 * Routes:
 * - POST /api/_webhook/await/{flowName}/{runId}/{stepName}
 * - GET /api/_webhook/await/{flowName}/{runId}/{stepName}
 *
 * Architecture:
 * 1. Parse URL params to get flowName, runId, stepName
 * 2. Look up flow in store index to verify it exists and is awaiting
 * 3. Verify flow status and await configuration
 * 4. Use useAwait().webhook.resolve() which publishes await.resolved event
 * 5. Trigger wiring handles the actual flow resumption
 */
export default defineEventHandler(async (event) => {
  const logger = useNventLogger('webhook-handler')
  const store = useStoreAdapter()
  const await$ = useAwait()
  const { StoreSubjects } = useStreamTopics()

  // Extract path parameters using H3
  const params = getRouterParams(event)
  const flowName = params.flowName
  const runId = params.runId
  const stepName = params.stepName

  if (!flowName || !runId || !stepName) {
    logger.warn('Missing required webhook parameters', { params })
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid webhook path',
      message: 'Webhook path must include flowName, runId, and stepName',
    })
  }

  logger.info(`Webhook received: ${event.method} for ${flowName}/${runId}/${stepName}`)

  // Look up flow in store index to verify it exists and is awaiting
  const indexKey = StoreSubjects.flowRunIndex(flowName)
  const flowEntry = await store.index.get?.(indexKey, runId)

  if (!flowEntry) {
    logger.warn(`Flow not found`, { flowName, runId, stepName })
    setResponseStatus(event, 404)
    throw createError({
      statusCode: 404,
      statusMessage: 'Flow not found',
      message: 'The flow associated with this webhook no longer exists.',
    })
  }

  // Check flow status - allow both 'running' and 'awaiting'
  const status = flowEntry.metadata?.status
  if (status && status !== 'running' && status !== 'awaiting') {
    logger.warn(`Flow is not running or awaiting`, { flowName, runId, stepName, status })
    setResponseStatus(event, 410)
    throw createError({
      statusCode: 410,
      statusMessage: `Flow is ${status}`,
      message: `This webhook is no longer valid because the flow is ${status}.`,
    })
  }

  // Check if step is actually awaiting
  // Try both composite keys (stepName:before and stepName:after) to find the awaiting webhook
  const awaitingSteps = flowEntry.metadata?.awaitingSteps || {}
  const awaitKeyBefore = `${stepName}:before`
  const awaitKeyAfter = `${stepName}:after`
  
  let awaitState = null
  let position: 'before' | 'after' = 'before'
  
  // Check 'before' position if it's awaiting
  const awaitStateBefore = awaitingSteps[awaitKeyBefore]
  if (awaitStateBefore && awaitStateBefore.status === 'awaiting') {
    awaitState = awaitStateBefore
    position = 'before'
  }
  
  // If not found in 'before', check 'after' position if it's awaiting
  if (!awaitState) {
    const awaitStateAfter = awaitingSteps[awaitKeyAfter]
    if (awaitStateAfter && awaitStateAfter.status === 'awaiting') {
      awaitState = awaitStateAfter
      position = 'after'
    }
  }
  
  // Fallback: try old format without position (backward compatibility)
  if (!awaitState) {
    const legacyAwaitState = awaitingSteps[stepName]
    if (legacyAwaitState && legacyAwaitState.status === 'awaiting') {
      awaitState = legacyAwaitState
      position = 'after' // Old system only supported awaitAfter
    }
  }
  
  if (!awaitState) {
    logger.warn(`Step is not awaiting`, { flowName, runId, stepName, awaitingSteps })
    setResponseStatus(event, 410)
    throw createError({
      statusCode: 410,
      statusMessage: 'Step is not awaiting',
      message: 'This webhook has already been called or the await has expired.',
    })
  }

  // Verify await type is webhook
  if (awaitState.awaitType !== 'webhook') {
    logger.warn(`Step is not waiting for webhook`, { flowName, runId, stepName, awaitType: awaitState.awaitType })
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid await type',
      message: `This step is waiting for ${awaitState.awaitType}, not a webhook.`,
    })
  }

  // Verify HTTP method if specified in config
  const expectedMethod = awaitState.config?.method || 'POST'
  if (event.method !== expectedMethod) {
    logger.warn(`Method mismatch: expected ${expectedMethod}, got ${event.method}`, { flowName, runId, stepName })
    throw createError({
      statusCode: 405,
      statusMessage: 'Method Not Allowed',
      message: `This webhook expects ${expectedMethod} requests.`,
    })
  }

  // Position was already determined when finding awaitState above

  // Get webhook payload
  let webhookData: any
  if (event.method === 'GET') {
    // For GET requests, use query parameters as payload
    webhookData = getRouterParams(event, { decode: true })
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
  await await$.webhook.resolve(runId, stepName, flowName, position, webhookData)

  logger.info(`Webhook await resolved`, { flowName, runId, stepName })

  return {
    success: true,
    runId,
    stepName,
    flowName,
    message: 'Webhook processed successfully. Flow will resume shortly.',
  }
})
