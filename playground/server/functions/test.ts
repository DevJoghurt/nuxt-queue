import { defineFunctionConfig, defineFunction } from '#imports'

export const config = defineFunctionConfig({
  queue: { name: 'email' },
  flow: {
    name: ['signup'],
    role: 'step',
    step: 'sendEmail',
    subscribes: ['user.created'],
  },
})

export default defineFunction(
  async (input, ctx) => {
    await ctx.state.set('lastEmail', {
      test: 'sdfdsf',
    })
    // Access Motia-style context
    ctx.logger.log('info', `Sending mail for job ${ctx.jobId} on ${ctx.queue}`, { jobId: ctx.jobId, traceId: ctx.traceId })
    // Enqueue next step in a flow if needed
    await ctx.flow.handleTrigger('email.sent', { to: input.to })
    // Use provider if you need to enqueue programmatically
    // await ctx.provider.enqueue('someQueue', { name: 'someStep', data: {} })
    return {
      ok: true,
    }
  })
