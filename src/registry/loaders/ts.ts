import type { ConfigMeta } from '../types'
import { createJiti } from 'jiti'

export async function loadTsConfig(absPath: string): Promise<ConfigMeta> {
  // Stub auto-imported helpers so requiring config doesn't throw
  const prevDQW = (globalThis as any).defineQueueWorker
  const prevDQC = (globalThis as any).defineQueueConfig
  ;(globalThis as any).defineQueueWorker = (meta: any, processor: any) => processor
  ;(globalThis as any).defineQueueConfig = (cfg: any) => cfg

  try {
    const jiti = createJiti(import.meta.url)
    const mod = await jiti.import(absPath)

    const cfg = mod?.config
    const queueName = (cfg && typeof cfg.queue === 'object' && cfg.queue) ? cfg.queue?.name : undefined

    const isolate: any = cfg?.runner?.ts?.isolate || cfg?.runner?.isolate || cfg?.isolate
    const runtype: ConfigMeta['runtype'] = isolate === 'task' ? 'task' : (isolate === 'inprocess' ? 'inprocess' : undefined)

    const flowCfg = cfg?.flow
    let flow: ConfigMeta['flow']
    if (flowCfg) {
      const subscribes = Array.isArray((flowCfg as any).subscribes)
        ? (flowCfg as any).subscribes
        : (typeof (flowCfg as any).subscribes === 'string' ? [(flowCfg as any).subscribes] : undefined)
      const names = Array.isArray((flowCfg as any).name)
        ? (flowCfg as any).name.filter((s: any) => typeof s === 'string' && s.length > 0)
        : (typeof (flowCfg as any).name === 'string' && (flowCfg as any).name.length > 0 ? [(flowCfg as any).name] : [])
      if (names.length) {
        flow = {
          names,
          role: flowCfg.role,
          step: flowCfg.step,
          emits: flowCfg.emits,
          subscribes,
        }
      }
    }

    const queueCfg = (cfg?.queue && typeof cfg.queue === 'object')
      ? { name: cfg.queue.name, defaultJobOptions: cfg.queue.defaultJobOptions, prefix: cfg.queue.prefix }
      : undefined

    const workerOpts = (cfg?.worker && typeof cfg.worker === 'object')
      ? { ...cfg.worker }
      : undefined

    const hasDefaultExport = !!(mod && mod.default)

    return { queueName, flow, runtype, queueCfg, workerOpts, hasDefaultExport }
  }
  finally {
    ;(globalThis as any).defineQueueWorker = prevDQW
    ;(globalThis as any).defineQueueConfig = prevDQC
  }
}
