export const config = {
  queue: { name: 'testflow' },
  flow: {
    names: ['sample-flow'],
    role: 'step',
    step: 'next',
    subscribes: ['start'],
  },
}

export default defineQueueWorker(
  async (input: any, ctx: any) => {
    await ctx.state.set('lastEmail', {
      test: 'sdfdsf',
    })
    ctx.logger.log('info', `Processing step for job ${ctx.jobId} on ${ctx.queue}`)

    // Emit trigger for potential next step
    await ctx.flow.emit('email.sent', { to: input.to })

    return {
      ok: true,
    }
  })
