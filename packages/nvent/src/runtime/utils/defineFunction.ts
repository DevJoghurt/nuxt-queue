import { $useQueueRegistry, useFlowEngine, useQueueAdapter } from '#imports'
import type { RunContext, NodeHandler } from '../worker/node/runner'

export type ExtendedRunContext = RunContext & {
  provider: ReturnType<typeof useQueueAdapter>
  flow: ReturnType<typeof useFlowEngine>
  registry: any
}

export type DefineFunction = (handler: (input: any, ctx: ExtendedRunContext) => Promise<any>) => NodeHandler

export const defineFunction: DefineFunction = (handler) => {
  // Adapt worker handler signature to NodeHandler used by the BullMQ adapter
  const wrapped: NodeHandler = async (input, ctx) => {
    // Lazily resolve provider and helpers at run time to avoid early init ordering issues
    const provider = useQueueAdapter()
    // Use ctx.flow if already provided (it has context-aware wrapper), otherwise create new
    const flow = ctx.flow || useFlowEngine()
    const registry = $useQueueRegistry() as any
    const extended: ExtendedRunContext = {
      ...ctx,
      provider,
      flow,
      registry,
    }
    return handler(input, extended)
  }
  return wrapped
}

export default defineFunction
