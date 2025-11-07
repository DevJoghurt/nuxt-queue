export const config = defineQueueConfig({
  queue: {
    name: 'example_queue',
  },
  // Optional: let queue name default to file name ("second_step")
  flow: {
    // Must include the flow name(s) this step participates in
    name: ['example-flow'],
    role: 'step',
    // This worker handles the "parallel_step" job name
    step: 'parallel_step',
    emits: ['parallel'],
    // Must match the emit from first_step
    subscribes: ['first_step.completed'],
  },
})

// wait function
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export default defineQueueWorker(
  async (input, ctx) => {
    // v0.4: Non-entry step - input is keyed by event name
    const firstStepData = input['first_step.completed']

    ctx.logger.log('info', `Starting job ${ctx.jobId} on ${ctx.queue}`, {
      jobId: ctx.jobId,
      flowId: ctx.flowId,
      flowName: ctx.flowName,
      receivedData: firstStepData,
    })

    for (let i = 0; i < 5; i++) {
      ctx.logger.log('info', `Parallel step progress ${i + 1}/5`, { progress: i + 1 })
      await wait(2000)
    }

    await ctx.flow.emit('parallel', {
      parallelResult: 'completed',
      fromFirstStep: firstStepData,
    })

    return {
      ok: true,
    }
  })
