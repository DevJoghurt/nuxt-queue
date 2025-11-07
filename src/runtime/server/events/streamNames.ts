import { useRuntimeConfig } from '#imports'

/**
 * Stream naming utilities
 *
 * Core streams:
 * - nq:flow:{runId}        - Flow run event stream
 * - nq:flows:{flowName}    - Sorted set index of flow runs by flow name
 */

export interface StreamNamesConfig {
  flow?: string | ((runId: string) => string)
  flowIndex?: string | ((flowName: string) => string)
}

function defaults(): Required<StreamNamesConfig> {
  return {
    flow: (runId: string) => `nq:flow:${runId}`,
    flowIndex: (flowName: string) => `nq:flows:${flowName}`,
  }
}

export interface StreamNames {
  flow: (runId: string) => string
  flowIndex: (flowName: string) => string
}

export function getStreamNames(): StreamNames {
  const rc: any = useRuntimeConfig()
  const cfg: StreamNamesConfig = rc?.queue?.eventStore?.streams || {}
  const d = defaults()

  return {
    flow: (typeof cfg.flow === 'string'
      ? (runId: string) => `${cfg.flow}${runId}`
      : cfg.flow || d.flow) as (runId: string) => string,
    flowIndex: (typeof cfg.flowIndex === 'string'
      ? (flowName: string) => `${cfg.flowIndex}${flowName}`
      : cfg.flowIndex || d.flowIndex) as (flowName: string) => string,
  }
}

export default getStreamNames
