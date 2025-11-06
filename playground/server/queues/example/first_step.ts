import { defineQueueConfig, defineQueueWorker } from '#imports'

export const config = defineQueueConfig({
  queue: {
    name: 'example_queue',
    defaultJobOptions: {
      attempts: 5, // Override default: retry up to 5 times instead of 3
      backoff: {
        type: 'exponential',
        delay: 2000, // Override: start with 2 second delay
      },
    },
    limiter: {
      max: 10, // Max 10 jobs
      duration: 60000, // per 60 seconds
    },
  },
  worker: {
    concurrency: 4, // Override default: process 3 jobs concurrently instead of 2
    lockDurationMs: 60000, // Override: increase lock duration to 60s
  },
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
    ctx.logger.log('info', `Starting new job ${ctx.jobId} on ${ctx.queue} (attempt ${ctx.attempt})`, {
      jobId: ctx.jobId,
      flowId: ctx.flowId,
      flowName: ctx.flowName,
      attempt: ctx.attempt,
    })

    // add state
    ctx.state.set('first_step_started_at', new Date().toISOString())

    // Test retry mechanism: fail on first 2 attempts
    const shouldFail = input?.testRetry && ctx.attempt && ctx.attempt < 3
    if (shouldFail) {
      ctx.logger.log('warn', `Simulating failure on attempt ${ctx.attempt}`, { attempt: ctx.attempt })
      throw new Error(`Simulated failure for testing retry (attempt ${ctx.attempt})`)
    }

    for (let i = 0; i < 5; i++) {
      ctx.logger.log('info', `First step progress ${i + 1}/5`, { progress: i + 1 })
      await wait(2000)
    }

    // v0.4: Trigger next steps using flowId (no need to pass it explicitly, context provides it)
    await ctx.flow.emit('first_step.completed', { test: 'data from first step' })

    return {
      ok: true,
      attempt: ctx.attempt,
    }
  })
