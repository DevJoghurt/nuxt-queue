import { $useQueueRegistry, useFlowEngine, useQueue } from '#imports'
import type { RunContext, NodeHandler } from '../worker/runner/node'

export type ExtendedRunContext = RunContext & {
  provider: ReturnType<typeof useQueue>
  flow: ReturnType<typeof useFlowEngine>
  registry: any
}

export type DefineQueueWorker = (handler: (input: any, ctx: ExtendedRunContext) => Promise<any>) => NodeHandler

export const defineQueueWorker: DefineQueueWorker = (handler) => {
  // Adapt worker handler signature to NodeHandler used by the BullMQ adapter
  const wrapped: NodeHandler = async (input, ctx) => {
    // Lazily resolve provider and helpers at run time to avoid early init ordering issues
    const provider = useQueue()
    const flow = useFlowEngine()
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

export default defineQueueWorker
