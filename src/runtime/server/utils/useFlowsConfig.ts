import { useEventManager } from '#imports'

export interface FlowConfigUpdate<T = any> {
  flowId: string
  config: T
}

export function useFlowsConfig() {
  const eventManager = useEventManager()

  async function publishConfig(flowId: string, config: any, ctx?: { queue?: string }) {
    // Publish as transient bus-only event (not persisted) so onKind consumers receive it by default
    await eventManager.publishBus({ kind: 'flow.config', subject: ctx?.queue, data: { flowId, config } })
  }

  function onConfig(handler: (update: FlowConfigUpdate & { raw: any }) => void) {
    return eventManager.onKind('flow.config', (evt) => {
      const d = (evt?.data || {}) as any
      handler({ flowId: d.flowId, config: d.config, raw: evt })
    })
  }

  return { publishConfig, onConfig }
}

export default useFlowsConfig
