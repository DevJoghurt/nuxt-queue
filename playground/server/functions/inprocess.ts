import { defineFunctionConfig, defineFunction } from '#imports'

export const config = defineFunctionConfig({
  flow: {
    name: ['resize-flow'],
    role: 'entry',
    step: 'resize',
    emits: ['resize.completed'],
    subscribes: ['thumbnail'],
  },
})

export default defineFunction(
  async (input, ctx) => {
    await ctx.state.set('lastEmail', {
      test: 'sdfdsf',
    })
    ctx.logger.log('info', `Processing resize for job ${ctx.jobId} on ${ctx.queue}`)

    // v0.4: Use ctx.flow.emit() for flow events
    await ctx.flow.emit('email.sent', { to: input.to })

    return {
      ok: true,
    }
  })
