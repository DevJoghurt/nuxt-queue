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

export default defineFunction(async (_input, ctx) => {
  const isRunning = await ctx.flow.isRunning('test-flow')
  ctx.logger.log('info', `Is 'test-flow' running? ${isRunning}`, isRunning)
  if (isRunning) {
    // get current running flows
    const runningFlows = await ctx.flow.getRunningFlows('test-flow', {
      excludeRunIds: [],
    })
    ctx.logger.log('info', `Current running flows for 'test-flow':`, runningFlows)
    // cancel all running flows
    for (const flow of runningFlows) {
      await ctx.flow.cancelFlow('test-flow', flow.id)
      ctx.logger.log('info', `Cancelled flow: ${ctx.flowName} (${flow.id})`)
    }
  }
})
