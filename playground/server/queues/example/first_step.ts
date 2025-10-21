export const config = defineQueueConfig({
  // Optional: let queue name default to file name ("first_step")
  flow: {
    // Use a single flow id shared by all steps in this flow
    id: 'example-flow',
    role: 'main',
    // The job name (step) that will be enqueued when starting the flow
    step: 'first_step',
    // The event(s) this step will emit on completion (used by downstream triggers)
    emits: ['first_step.completed'],
  },
})

// wait function
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export default defineQueueWorker(
  async (input, ctx) => {
    await ctx.state.set('first_step', {
      test: 'step',
    })
    // Access Motia-style context
    ctx.logger.log('info', `Starting job ${ctx.jobId} on ${ctx.queue}`, { jobId: ctx.jobId, traceId: ctx.traceId })

    for (let i = 0; i < 5; i++) {
      ctx.logger.log('info', `First step progress ${i + 1}/5`, { progress: i + 1 })
      await wait(1000)
    }

    // Enqueue the next step in the flow after finishing this one.
    // Pass correlationId so the engine can tie steps together and ensure idempotency.
    await ctx.flow.handleTrigger('first_step.completed', { test: 'data from first step', correlationId: ctx.traceId })

    return {
      ok: true,
    }
  })
