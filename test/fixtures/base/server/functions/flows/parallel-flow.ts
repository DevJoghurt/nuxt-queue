import { defineFunctionConfig, defineFunction } from '#imports'

export const config = defineFunctionConfig({
  queue: {
    name: 'flows',
  },
  flow: {
    name: 'parallel-flow',
    role: 'entry',
    step: 'start',
    emits: ['start.task-a', 'start.task-b'],
  },
})

export default defineFunction(
  async (input, ctx) => {
    ctx.logger.log('info', 'Parallel flow started')

    // Emit multiple parallel steps
    await ctx.flow.emit('start.task-a', { task: 'A' })
    await ctx.flow.emit('start.task-b', { task: 'B' })

    return { step: 'start', parallelTasksEmitted: 2 }
  })
