export const config = {
  queue: { name: 'testflow' },
  flow: {
    names: ['sample-flow'],
    role: 'entry',
    step: 'start',
    emits: ['start'],
  },
}

export default defineQueueWorker(
  async (input: any, ctx: any) => {
    await ctx.state.set('flowInput', input)
    ctx.logger.log('info', `Starting flow ${ctx.flowName} run ${ctx.flowId}`)

    // Emit trigger for next step
    await ctx.flow.emit('start', { input })

    return {
      ok: true,
      result: { ok: true },
    }
  })
