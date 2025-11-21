import { defineFunctionConfig, defineFunction } from '#imports'

/**
 * Example: Notification with Confirmation Flow
 *
 * Demonstrates awaitAfter with time delay
 * Sends notification, waits for confirmation or timeout
 */

export const config = defineFunctionConfig({
  queue: { name: 'notifications' },
  flow: {
    name: 'notification-confirmation-flow',
    role: 'entry',
    step: 'send-notification',
    emits: ['notification.sent'],
    triggers: {
      define: {
        name: 'manual.notification-test',
        type: 'manual',
        scope: 'flow',
        displayName: 'Manual Notification Test',
        description: 'Manually trigger notification flow for testing',
      },
      subscribe: ['manual.notification-test'],
      mode: 'auto',
    },
    awaitAfter: {
      type: 'time',
      delay: 10000, // Wait 10 seconds before allowing next steps
    },
  },
})

export default defineFunction(async (input, ctx) => {
  const logger = ctx.logger

  logger.log('info', 'Sending notification', {
    recipient: input.trigger?.data?.recipient,
    message: input.trigger?.data?.message,
  })

  // Simulate sending notification
  await new Promise(resolve => setTimeout(resolve, 1000))

  await ctx.flow.emit('notification.sent', {
    notificationId: ctx.runId,
    recipient: input.trigger?.data?.recipient,
    sentAt: Date.now(),
  })

  return {
    success: true,
    notificationId: ctx.runId,
    message: 'Notification sent, waiting 10s before proceeding',
  }
})
