import { defineEventHandler, readBody, getRouterParam } from 'h3'
import { useStoreAdapter, useStreamTopics, useNventLogger } from '#imports'
import { resolveWebhookAwait } from '../../../../../utils/awaitPatterns/webhook'

/**
 * Dynamic webhook handler for await patterns
 * Handles webhook calls and resolves awaiting steps
 *
 * Routes:
 * - POST /api/nvent/webhook/await/{path...}
 * - GET /api/nvent/webhook/await/{path...}
 */
export default defineEventHandler(async (event) => {
  const logger = useNventLogger('webhook-handler')
  const store = useStoreAdapter()
  const { SubjectPatterns } = useStreamTopics()

  // Get the full path after /api/nvent/webhook/await/
  const path = event.path.replace('/api/nvent/webhook/await/', '')

  logger.info(`Webhook received: ${event.method} ${path}`)

  // Look up webhook registration in KV
  const routeKey = SubjectPatterns.webhookRoute(`/${path}`)
  const registration = await store.kv?.get<any>(routeKey)

  if (!registration) {
    logger.warn(`No webhook await registered for path: ${path}`)
    return {
      error: 'Webhook not found or expired',
      path,
    }
  }

  // Verify method matches
  if (event.method !== registration.method) {
    logger.warn(`Method mismatch: expected ${registration.method}, got ${event.method}`)
    return {
      error: `Method not allowed. Expected ${registration.method}`,
    }
  }

  // Get webhook payload
  let webhookData: any
  if (event.method === 'GET') {
    webhookData = getRouterParam(event, 'query') || {}
  }
  else {
    webhookData = await readBody(event)
  }

  logger.debug(`Webhook data received`, {
    runId: registration.runId,
    stepName: registration.stepName,
    dataKeys: Object.keys(webhookData || {}),
  })

  // TODO: Validate against schema if provided
  // if (registration.schema) {
  //   const schema = eval(registration.schema)
  //   const result = schema.safeParse(webhookData)
  //   if (!result.success) {
  //     return { error: 'Validation failed', errors: result.error.errors }
  //   }
  // }

  // Resolve the await
  await resolveWebhookAwait(
    registration.runId,
    registration.stepName,
    webhookData,
  )

  logger.info(`Webhook await resolved`, {
    runId: registration.runId,
    stepName: registration.stepName,
  })

  return {
    success: true,
    runId: registration.runId,
    stepName: registration.stepName,
    message: 'Await pattern resolved successfully',
  }
})
