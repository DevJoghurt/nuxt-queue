import { defineFunctionConfig, defineFunction } from '#imports'

export const config = defineFunctionConfig({
  queue: {
    name: 'test-queue',
  },
  flow: {
    name: 'test-flow',
    role: 'step',
    step: 'step-2',
    emits: ['step.done'],
    subscribes: ['entry.done'],
    awaitBefore: {
      type: 'schedule',
      cron: '*/1 * * * *', // after 1 minutes
    },
    awaitAfter: {
      type: 'webhook',
      method: 'GET',
    },
    stepTimeout: 1200000, // Step execution timeout in ms (20 minutes)
  },
})

export default defineFunction(async (input, ctx) => {
  ctx.flow.emit('step.done', { step: 'step-2' })
})
