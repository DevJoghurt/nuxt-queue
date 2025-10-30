export const config = defineQueueConfig({
  queue: {
    name: 'example_queue',
  },
  // Optional: let queue name default to file name ("first_step")
  flow: {
    // Declare one or more flow names this step belongs to
    name: ['example-flow'],
    role: 'entry',
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
    // v0.4: Use flowId and flowName from context
    ctx.logger.log('info', `Starting job ${ctx.jobId} on ${ctx.queue}`, { jobId: ctx.jobId, flowId: ctx.flowId, flowName: ctx.flowName })

    for (let i = 0; i < 5; i++) {
      ctx.logger.log('info', `First step progress ${i + 1}/5`, { progress: i + 1 })
      await wait(2000)
    }

    // v0.4: Trigger next steps using flowId (no need to pass it explicitly, context provides it)
    await ctx.flow.handleTrigger('first_step.completed', { test: 'data from first step' })

    return {
      ok: true,
    }
  })
