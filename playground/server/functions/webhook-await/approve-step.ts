import { defineFunctionConfig, defineFunction, defineAwaitRegisterHook, defineAwaitTimeoutHook } from '#imports'

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
      method: 'GET',
      timeout: 20000, // 20 seconds for testing
      timeoutAction: 'fail',
    },
  },
})

// Lifecycle hook: Called when await is registered
export const onAwaitRegister = defineAwaitRegisterHook<'webhook'>(async (hookData, stepData, ctx) => {
  ctx.logger.log('info', 'Webhook approval URL generated', {
    url: hookData.webhookUrl,
    runId: ctx.flowId,
    step: ctx.stepName,
  })

  // In production: Send email, Slack notification, etc.
  // For demo: Log the webhook URL
  console.log('==========================================')
  console.log('🔗 APPROVAL WEBHOOK URL:')
  console.log(`   POST ${hookData.webhookUrl}`)
  console.log(`   Body: { "approved": true/false, "comment": "..." }`)
  console.log('==========================================')
})

export const onAwaitTimeout = defineAwaitTimeoutHook(async (stepData, ctx) => {
  ctx.logger.log('warn', 'Approval request timed out')

  console.log('==========================================')
  console.log('⚠️ APPROVAL REQUEST TIMED OUT')
  console.log(`   Run ID: ${ctx.flowId}`)
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
