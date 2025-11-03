// Local stub for tests: registry stubs defineQueueWorker at runtime
// but TypeScript needs a declaration here.
declare const defineQueueWorker: any

export const config = {
  queue: { name: 'testflow' },
  flow: {
    name: ['sample-flow'],
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
    }
  })
