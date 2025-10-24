import type { LayerInfo } from './types'
import { scanWorkers } from './scan'
import { buildFlows } from './flows'

export async function compileRegistryFromServerWorkers(layers: LayerInfo[], queuesDir = 'queues') {
  const { workers, flowSources } = await scanWorkers(layers, queuesDir)
  const { flows, eventIndex } = buildFlows(flowSources)

  const compiled = {
    workers,
    flows,
    eventIndex,
  }

  return compiled
}

export * from './types'
