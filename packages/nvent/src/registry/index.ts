import type { LayerInfo } from './types'
import { scanWorkers } from './scan'
import { buildFlows } from './flowBuilder'
import { mergeAllWorkerConfigs, type DefaultConfigs } from './configMerger'

export async function compileRegistryFromServerWorkers(layers: LayerInfo[], queuesDir = 'queues', defaults?: DefaultConfigs) {
  const { workers, flowSources } = await scanWorkers(layers, queuesDir)

  // Merge default configs from nuxt.config with per-worker configs
  const mergedWorkers = defaults ? mergeAllWorkerConfigs(workers, defaults) : workers

  const { flows, eventIndex } = buildFlows(flowSources)

  const compiled = {
    workers: mergedWorkers,
    flows,
    eventIndex,
  }

  return compiled
}

export * from './flowAnalyzer'

export * from './types'
export * from './configMerger'
