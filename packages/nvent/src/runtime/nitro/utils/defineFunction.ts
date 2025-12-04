import type { RunContext, NodeHandler } from '../../worker/node/runner'

export const defineFunction = <TInput = any, TOutput = any>(
  handler: (input: TInput, ctx: RunContext) => Promise<TOutput>,
): NodeHandler => {
  // Return handler as-is since RunContext already has everything needed
  return handler as NodeHandler
}

export default defineFunction
