import { defineFunctionConfig, defineFunction } from '#imports'

/**
 * Example: Webhook Approval Flow
 *
 * Demonstrates awaitBefore pattern with webhook
 * Use case: Manager approval required before processing
 *
 * Test via UI: /playground/triggers
 */

export const config = defineFunctionConfig({
  queue: { name: 'approvals' },
  flow: {
    name: 'webhook-approval-flow',
    role: 'entry',
    step: 'request-approval',
    emits: ['approval.requested'],
    triggers: {
      define: {
        name: 'manual.webhook-approval',
        type: 'manual',
        scope: 'flow',
        displayName: 'Manual Webhook Approval Test',
        description: 'Manually trigger webhook approval flow for testing',
      },
      subscribe: ['manual.webhook-approval'],
      mode: 'auto',
    },
  },
})

export default defineFunction(async (input, ctx) => {
  const logger = ctx.logger

  logger.log('info', 'Approval request received', {
    request: input.trigger?.data,
  })

  // Emit event that next step is ready
  await ctx.flow.emit('approval.requested', {
    requestId: ctx.runId,
    requestedBy: input.trigger?.data?.requestedBy || 'unknown',
    amount: input.trigger?.data?.amount || 0,
    timestamp: Date.now(),
  })

  return {
    success: true,
    requestId: ctx.runId,
  }
})
