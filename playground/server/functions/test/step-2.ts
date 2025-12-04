import { defineFunctionConfig, defineFunction } from '#imports'

export const config = defineFunctionConfig({
  queue: {
    name: 'test-queue',
  },
  flow: {
    name: 'test-flow',
    role: 'step',
    step: 'step-2',
    subscribes: ['entry.done'],
    awaitBefore: {
      type: 'schedule',
      cron: '*/1 * * * *', // after 1 minutes
    },
  },
})

export default defineFunction(async (input, ctx) => {

})
