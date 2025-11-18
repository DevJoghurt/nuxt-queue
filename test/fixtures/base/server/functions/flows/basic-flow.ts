import { defineFunctionConfig, defineFunction } from '#imports'

export const config = defineFunctionConfig({
  queue: {
    name: 'flows',
  },
  flow: {
    name: 'basic-flow',
    role: 'entry',
    step: 'start',
    emits: ['start.completed'],
  },
})

export default defineFunction(
  async (input, ctx) => {
    ctx.logger.log('info', 'Flow started', { flowId: ctx.flowId })

    await ctx.state.set('startTime', Date.now())

    // Emit next step
    await ctx.flow.emit('start.completed', { message: 'Hello from start' })

    return { step: 'start', completed: true }
  })
