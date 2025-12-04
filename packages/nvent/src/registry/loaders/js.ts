import { pathToFileURL } from 'node:url'
import type { ConfigMeta } from '../types'

export async function loadJsConfig(absPath: string): Promise<ConfigMeta> {
  // Add timestamp to bust Node's module cache
  const cacheBust = `?t=${Date.now()}`
  const mod = await import(pathToFileURL(absPath).href + cacheBust)

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
        triggers: flowCfg.triggers,
        awaitBefore: flowCfg.awaitBefore,
        awaitAfter: flowCfg.awaitAfter,
      }
    }
  }

  const queueCfg = (cfg?.queue && typeof cfg.queue === 'object')
    ? {
        name: cfg.queue.name,
        defaultJobOptions: cfg.queue.defaultJobOptions,
        prefix: cfg.queue.prefix,
        limiter: cfg.queue.limiter,
      }
    : undefined

  const workerCfg = (cfg?.worker && typeof cfg.worker === 'object')
    ? { ...cfg.worker }
    : undefined

  const hasDefaultExport = !!(mod && mod.default)

  // Check for lifecycle hooks
  // Hooks can be plain functions or wrapped with defineAwaitRegisterHook/defineAwaitResolveHook/defineAwaitTimeoutHook
  const hasHooks = !!(
    (mod && typeof mod.onAwaitRegister === 'function')
    || (mod && typeof mod.onAwaitResolve === 'function')
    || (mod && typeof mod.onAwaitTimeout === 'function')
  )

  return { queueName, flow, runtype, queue: queueCfg, worker: workerCfg, hasDefaultExport, hasHooks }
}
