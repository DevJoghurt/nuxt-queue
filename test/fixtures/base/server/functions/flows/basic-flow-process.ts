import { defineFunctionConfig, defineFunction } from '#imports'

export const config = defineFunctionConfig({
  queue: {
    name: 'flows',
  },
  flow: {
    name: 'basic-flow',
    role: 'step',
    step: 'process',
    subscribes: ['start.completed'],
    emits: ['process.completed'],
  },
})

export default defineFunction(
  async (input, ctx) => {
    ctx.logger.log('info', 'Processing step', { flowId: ctx.flowId })

    const startTime = await ctx.state.get('startTime')
    await ctx.state.set('processTime', Date.now())

    // Emit final step
    await ctx.flow.emit('process.completed', { startTime, message: 'Processed' })

    return { step: 'process', completed: true }
  })
