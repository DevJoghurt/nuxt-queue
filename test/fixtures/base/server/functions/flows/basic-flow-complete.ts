import { defineFunctionConfig, defineFunction } from '#imports'

export const config = defineFunctionConfig({
  queue: {
    name: 'flows',
  },
  flow: {
    name: 'basic-flow',
    role: 'step',
    step: 'complete',
    subscribes: ['process.completed'],
  },
})

export default defineFunction(
  async (input, ctx) => {
    ctx.logger.log('info', 'Completing flow', { flowId: ctx.flowId })

    const startTime = await ctx.state.get('startTime')
    const processTime = await ctx.state.get('processTime')

    return {
      step: 'complete',
      completed: true,
      duration: processTime - startTime,
    }
  })
