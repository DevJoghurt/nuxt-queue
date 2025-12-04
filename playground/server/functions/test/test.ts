import { defineFunctionConfig, defineFunction } from '#imports'

export const config = defineFunctionConfig({
  queue: {
    name: 'test-queue',
  },
  flow: {
    name: 'test-flow',
    role: 'entry',
    step: 'test-step',
    emits: ['entry.done'],
    awaitAfter: {
      type: 'time',
      delay: 10000,
    },
  },
})

export default defineFunction(async (input, ctx) => {
  ctx.flow.emit('entry.done', { message: 'Entry step completed' })
})
