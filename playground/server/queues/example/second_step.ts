export const config = defineQueueConfig({
  queue: {
    name: 'example_queue',
  },
  // Optional: let queue name default to file name ("second_step")
  flow: {
    // Must include the flow name(s) this step participates in
    name: ['example-flow'],
    role: 'step',
    // This worker handles the "second_step" job name
    step: 'second_step',
    // Must match the emit from first_step
    subscribes: ['first_step.completed'],
  },
})

// wait function
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export default defineQueueWorker(
  async (input, ctx) => {
    // v0.4: Use flowId and flowName from context
    ctx.logger.log('info', `Starting job ${ctx.jobId} on ${ctx.queue}`, { jobId: ctx.jobId, flowId: ctx.flowId, flowName: ctx.flowName })

    for (let i = 0; i < 5; i++) {
      ctx.logger.log('info', `Second step progress ${i + 1}/5`, { progress: i + 1 })
      await wait(2000)
    }

    return {
      ok: true,
    }
  })
