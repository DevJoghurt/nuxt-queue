import { defineFunctionConfig, defineFunction } from '#imports'

export const config = defineFunctionConfig({
  queue: {
    name: 'flows',
  },
  flow: {
    name: 'parallel-flow',
    role: 'step',
    step: 'task-a',
    subscribes: ['start.task-a'],
    emits: ['task-a.gather'],
  },
})

export default defineFunction(
  async (input, ctx) => {
    ctx.logger.log('info', 'Task A executing')
    await ctx.state.set('task-a-result', 'completed')

    // Both tasks emit to gather
    await ctx.flow.emit('task-a.gather', { from: 'task-a' })

    return { task: 'A', completed: true }
  })
