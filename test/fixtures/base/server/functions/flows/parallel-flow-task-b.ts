import { defineFunctionConfig, defineFunction } from '#imports'

export const config = defineFunctionConfig({
  queue: {
    name: 'flows',
  },
  flow: {
    name: 'parallel-flow',
    role: 'step',
    step: 'task-b',
    subscribes: ['start.task-b'],
    emits: ['task-b.gather'],
  },
})

export default defineFunction(
  async (input, ctx) => {
    ctx.logger.log('info', 'Task B executing')
    await ctx.state.set('task-b-result', 'completed')

    // Both tasks emit to gather
    await ctx.flow.emit('task-b.gather', { from: 'task-b' })

    return { task: 'B', completed: true }
  })
