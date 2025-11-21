import { defineFunctionConfig, defineFunction } from '#imports'

/**
 * Example: Event-Driven Order Processing
 *
 * Demonstrates awaitBefore with event pattern
 * Waits for payment.completed event before processing
 */

export const config = defineFunctionConfig({
  queue: { name: 'orders' },
  flow: {
    name: 'order-processing-flow',
    role: 'entry',
    step: 'create-order',
    emits: ['order.created'],
    triggers: {
      define: {
        name: 'manual.order-test',
        type: 'manual',
        scope: 'flow',
        displayName: 'Manual Order Test',
        description: 'Manually trigger order processing flow for testing',
      },
      subscribe: ['manual.order-test'],
      mode: 'auto',
    },
  },
})

export default defineFunction(async (input, ctx) => {
  const logger = ctx.logger

  const orderData = input.trigger?.data

  logger.log('info', 'Creating order', {
    orderId: ctx.runId,
    items: orderData?.items,
    total: orderData?.total,
  })

  await ctx.flow.emit('order.created', {
    orderId: ctx.runId,
    items: orderData?.items || [],
    total: orderData?.total || 0,
    status: 'awaiting_payment',
    createdAt: Date.now(),
  })

  return {
    success: true,
    orderId: ctx.runId,
    status: 'created',
  }
})
