import { defineFunctionConfig, defineFunction } from '#imports'

/**
 * Example: Follow-up Step
 *
 * Runs after time delay completes
 */

export const config = defineFunctionConfig({
  queue: { name: 'notifications' },
  flow: {
    name: 'notification-confirmation-flow',
    role: 'step',
    step: 'follow-up',
    subscribes: ['notification.sent'],
    emits: ['follow-up.completed'],
  },
})

export default defineFunction(async (input, ctx) => {
  const logger = ctx.logger

  logger.log('info', 'Running follow-up after delay', {
    notificationId: input['notification.sent']?.notificationId,
  })

  await ctx.flow.emit('follow-up.completed', {
    completedAt: Date.now(),
  })

  return {
    success: true,
    message: 'Follow-up completed after 10 second delay',
  }
})
