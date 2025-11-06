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
    step: 'test_parallel',
    // Must match the emit from first_step
    subscribes: ['parallel'],
    emits: ['parallel_test.completed'],
  },
  worker: {
    concurrency: 2, // Process up to 2 jobs in parallel
  },
})

// wait function
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export default defineQueueWorker(
  async (input, ctx) => {
    // v0.4: Non-entry step - input is keyed by event name
    const parallelData = input['parallel']

    ctx.logger.log('info', `Starting job ${ctx.jobId} on ${ctx.queue}`, {
      jobId: ctx.jobId,
      flowId: ctx.flowId,
      flowName: ctx.flowName,
      receivedData: parallelData,
    })

    for (let i = 0; i < 10; i++) {
      ctx.logger.log('info', `Test parallel progress ${i + 1}/10`, { progress: i + 1 })
      await wait(2000)
    }

    await ctx.flow.emit('parallel_test.completed', {
      result: 'Parallel test step completed',
      fromParallel: parallelData,
    })

    return {
      ok: true,
    }
  })
