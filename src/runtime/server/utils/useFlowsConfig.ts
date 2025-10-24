import { useEventManager } from '#imports'

export interface FlowConfigUpdate<T = any> {
  flowId: string
  config: T
}

export function useFlowsConfig() {
  const eventManager = useEventManager()

  async function publishConfig(flowId: string, config: any, ctx?: { queue?: string }) {
    await eventManager.publish({ kind: 'flow.config', data: { flowId, config } }, { flowId, ...ctx })
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
