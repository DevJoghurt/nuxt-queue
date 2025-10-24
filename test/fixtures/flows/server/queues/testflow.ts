// Local stub for tests: registry stubs defineQueueWorker at runtime
// but TypeScript needs a declaration here.
declare const defineQueueWorker: any
export const config = {
  flow: {
    name: ['sample-flow'],
    role: 'entry',
    step: 'start',
    // triggers/emits optional for entry
  },
}

export default defineQueueWorker(
  async (input: any, ctx: any) => {
    await ctx.state.set('lastEmail', {
      test: 'sdfdsf',
    })
    // Access Motia-style context
    ctx.logger.log('info', `Sending mail for job ${ctx.jobId} on ${ctx.queue}`)
    // Enqueue next step in a flow if needed
    await ctx.flow.handleTrigger('email.sent', { to: input.to })
    // Use provider if you need to enqueue programmatically
    // await ctx.provider.enqueue('someQueue', { name: 'someStep', data: {} })
    return {
      ok: true,
    }
  })
