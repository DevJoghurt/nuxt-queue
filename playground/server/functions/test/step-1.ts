import { defineFunctionConfig, defineFunction } from '#imports'

export const config = defineFunctionConfig({
  queue: {
    name: 'test-queue',
  },
  flow: {
    name: 'test-flow',
    role: 'step',
    step: 'step-1',
    subscribes: ['entry.done'],
  },
})

export default defineFunction(async (input, ctx) => {

})
