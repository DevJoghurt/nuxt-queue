import { defineFunctionConfig, defineFunction, defineAwaitRegisterHook } from '#imports'

/**
 * Example: Process Approval Step
 *
 * Demonstrates awaitBefore with webhook
 * Waits for webhook call before executing
 */

export const config = defineFunctionConfig({
  queue: { name: 'approvals' },
  flow: {
    name: 'webhook-approval-flow',
    role: 'step',
    step: 'process-approval',
    subscribes: ['approval.requested'],
    emits: ['approval.processed'],
    awaitBefore: {
      type: 'webhook',
      path: '/approve/{runId}/{stepName}',
      method: 'POST',
      timeout: 300000, // 5 minutes for testing
      timeoutAction: 'fail',
    },
  },
})

// Lifecycle hook: Called when await is registered
export const onAwaitRegister = defineAwaitRegisterHook(async (webhookUrl, awaitData, ctx) => {
  ctx.logger.log('info', 'Webhook approval URL generated', {
    url: webhookUrl,
    runId: ctx.flowId,
    step: ctx.stepName,
  })

  // In production: Send email, Slack notification, etc.
  // For demo: Log the webhook URL
  console.log('==========================================')
  console.log('🔗 APPROVAL WEBHOOK URL:')
  console.log(`   POST ${webhookUrl}`)
  console.log(`   Body: { "approved": true/false, "comment": "..." }`)
  console.log('==========================================')
})

export default defineFunction(async (input, ctx) => {
  const logger = ctx.logger

  // This only runs AFTER webhook is called
  const approval = ctx.trigger // Webhook payload

  logger.log('info', 'Processing approval', {
    approved: approval?.approved,
    comment: approval?.comment,
    requestData: input,
  })

  if (!approval?.approved) {
    throw new Error(`Approval denied: ${approval?.comment || 'No reason provided'}`)
  }

  await ctx.flow.emit('approval.processed', {
    requestId: ctx.flowId,
    approvedBy: approval?.approvedBy || 'unknown',
    approvedAt: Date.now(),
    comment: approval?.comment,
  })

  return {
    success: true,
    approved: true,
    comment: approval?.comment,
  }
})
