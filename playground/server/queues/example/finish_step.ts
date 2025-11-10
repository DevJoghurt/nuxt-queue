import { defineQueueConfig, defineQueueWorker } from '#imports'

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
    step: 'finish',
    // Must match the emit from first_step
    subscribes: ['test.completed', 'parallel_test.completed'],
  },
})

export default defineQueueWorker(
  async (input, ctx) => {
    // v0.4: Non-entry step with multiple dependencies - input is keyed by event name
    const testData = input['test.completed']
    const parallelTestData = input['parallel_test.completed']

    ctx.logger.log('info', `Starting job ${ctx.jobId} on ${ctx.queue}`, {
      jobId: ctx.jobId,
      flowId: ctx.flowId,
      flowName: ctx.flowName,
      receivedFromTest: testData,
      receivedFromParallelTest: parallelTestData,
    })

    ctx.logger.log('info', 'Finish step completed - flow done!', {
      testResult: testData?.result,
      parallelTestResult: parallelTestData?.result,
    })

    return {
      ok: true,
      summary: {
        test: testData,
        parallelTest: parallelTestData,
      },
    }
  })
