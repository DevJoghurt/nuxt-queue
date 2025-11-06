import type { ConfigMeta } from '../types'
import { readFile } from 'node:fs/promises'
import { parseModule } from 'magicast'

export async function loadTsConfig(absPath: string): Promise<ConfigMeta> {
  try {
    // Read and parse the file using magicast (AST parsing, no execution)
    const source = await readFile(absPath, 'utf-8')
    const mod = parseModule(source)

    // Check for default export
    const hasDefaultExport = !!mod.exports.default

    // Extract the config export
    const configExport = mod.exports.config
    if (!configExport) {
      return { hasDefaultExport }
    }

    // Parse the config - it's wrapped in defineQueueConfig({ ... })
    const cfg = extractConfigValue(configExport)

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

    return { queueName, flow, runtype, queue: queueCfg, worker: workerCfg, hasDefaultExport }
  }
  catch (error) {
    throw new Error(`Failed to parse config from ${absPath}: ${error}`)
  }
}

// Helper to extract config value from magicast proxy
function extractConfigValue(value: any): any {
  // If it's a magicast proxy with $ast, we need to extract the actual value
  if (value && typeof value === 'object' && '$ast' in value) {
    return astToValue(value.$ast)
  }
  return value
}

// Convert AST nodes to plain JavaScript values
function astToValue(node: any): any {
  if (!node) return undefined

  switch (node.type) {
    case 'CallExpression':
      // defineQueueConfig({ ... }) - extract the first argument
      if (node.arguments?.length > 0) {
        return astToValue(node.arguments[0])
      }
      return undefined

    case 'ObjectExpression':
      return node.properties?.reduce((obj: any, prop: any) => {
        if (prop.type === 'ObjectProperty' || prop.type === 'Property') {
          const key = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value
          obj[key] = astToValue(prop.value)
        }
        return obj
      }, {}) || {}

    case 'ArrayExpression':
      return node.elements?.map((el: any) => astToValue(el)) || []

    case 'Literal':
    case 'StringLiteral':
    case 'NumericLiteral':
    case 'BooleanLiteral':
      return node.value

    case 'Identifier':
      // Can't resolve variable references
      return undefined

    case 'TemplateLiteral':
      // Simple template without expressions
      if (node.expressions?.length === 0 && node.quasis?.length === 1) {
        return node.quasis[0].value.cooked
      }
      return undefined

    default:
      return undefined
  }
}
