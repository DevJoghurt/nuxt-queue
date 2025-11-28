import { defineFunctionConfig, defineFunction, defineAwaitRegisterHook } from '#imports'

/**
 * Example: Process Order After Payment
 *
 * Demonstrates awaitBefore with event
 * Waits for external payment.completed event
 */

export const config = defineFunctionConfig({
  queue: { name: 'orders' },
  flow: {
    name: 'order-processing-flow',
    role: 'step',
    step: 'process-order',
    subscribes: ['order.created'],
    emits: ['order.processed'],
    awaitBefore: {
      type: 'event',
      event: 'payment.completed',
      timeout: 50000, // 50 seconds
      timeoutAction: 'fail',
    },
  },
})

export const onAwaitRegister = defineAwaitRegisterHook(async (eventName, awaitData, ctx) => {
  ctx.logger.log('info', 'Waiting for payment event', {
    event: eventName,
    orderId: ctx.flowId,
  })

  console.log('==========================================')
  console.log('⏳ WAITING FOR PAYMENT EVENT:')
  console.log(`   Event: ${eventName}`)
  console.log(`   Order ID: ${ctx.flowId}`)
  console.log(`   Trigger via: POST /api/test/emit-event`)
  console.log(`   Body: { "eventName": "payment.completed", "payload": { "amount": 100 } }`)
  console.log('==========================================')
})

export default defineFunction(async (input, ctx) => {
  const logger = ctx.logger

  // This runs AFTER payment.completed event is received
  const paymentData = ctx.trigger

  logger.log('info', 'Processing order with payment', {
    orderId: ctx.flowId,
    payment: paymentData,
    order: input['order.created'],
  })

  await ctx.flow.emit('order.processed', {
    orderId: ctx.flowId,
    status: 'completed',
    paymentAmount: paymentData?.amount,
    processedAt: Date.now(),
  })

  return {
    success: true,
    orderId: ctx.flowId,
    status: 'processed',
  }
})
