import { defineFunctionConfig, defineFunction } from '#imports'

export const config = defineFunctionConfig({
  queue: {
    name: 'test',
  },
  flow: {
    name: 'simple',
    role: 'entry',
    step: 'simple',
  },
})

export default defineFunction(
  async (input, ctx) => {
    ctx.logger.log('info', 'Simple function executed', { data: input })
    return { success: true, input }
  })
