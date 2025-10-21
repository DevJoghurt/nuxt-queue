import { $useQueueRegistry, $useFlowEngine } from '#imports'
import type { RunContext, NodeHandler } from '../runner/node'
import { useQueueProvider } from '../providers/queue'
import type { QueueProvider } from '../providers/queue/contracts'

export type ExtendedRunContext = RunContext & {
  provider: QueueProvider
  flow: ReturnType<typeof $useFlowEngine>
  registry: any
}

export type DefineQueueWorker = (handler: (input: any, ctx: ExtendedRunContext) => Promise<any>) => NodeHandler

export const defineQueueWorker: DefineQueueWorker = (handler) => {
  // Adapt worker handler signature to NodeHandler used by the BullMQ adapter
  const wrapped: NodeHandler = async (input, ctx) => {
    // Lazily resolve provider and helpers at run time to avoid early init ordering issues
    const provider = useQueueProvider()
    const flow = $useFlowEngine()
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
