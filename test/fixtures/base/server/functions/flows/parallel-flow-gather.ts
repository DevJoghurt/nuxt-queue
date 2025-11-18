import { defineFunctionConfig, defineFunction } from '#imports'

export const config = defineFunctionConfig({
  queue: {
    name: 'flows',
  },
  flow: {
    name: 'parallel-flow',
    role: 'step',
    step: 'gather',
    subscribes: ['task-a.gather', 'task-b.gather'],
  },
})

export default defineFunction(
  async (input, ctx) => {
    ctx.logger.log('info', 'Gathering results', { from: input })

    const taskA = await ctx.state.get('task-a-result')
    const taskB = await ctx.state.get('task-b-result')

    return {
      step: 'gather',
      results: { taskA, taskB },
      completed: true,
    }
  })
