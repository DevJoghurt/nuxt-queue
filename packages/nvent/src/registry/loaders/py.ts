import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { ConfigMeta, NuxtQueueLogger } from '../types'

export async function loadPyConfig(absPath: string, logger?: NuxtQueueLogger): Promise<ConfigMeta> {
  const moduleDir = dirname(fileURLToPath(import.meta.url))

  const helper = join(moduleDir, '..', '..', 'runtime', 'worker', 'python', 'get_config.py')

  let pyConfig: any | undefined
  if (existsSync(helper)) {
    pyConfig = await new Promise<any | undefined>((resolve) => {
      try {
        const child = spawn('python3', [helper, absPath], {
          stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
          env: { ...process.env, NODE_CHANNEL_FD: '3' },
        })

        let dataBuf = ''
        const fd = (child.stdio as any)[3]
        const stream = (fd as any) || child.stdout
        stream.setEncoding('utf-8')
        stream.on('data', (chunk: string) => {
          dataBuf += chunk
        })
        child.on('error', () => resolve(undefined))
        child.on('close', () => {
          const line = dataBuf.split('\n').find(l => l.trim().length > 0)
          if (!line) return resolve(undefined)
          try {
            resolve(JSON.parse(line))
          }
          catch {
            resolve(undefined)
          }
        })
      }
      catch {
        resolve(undefined)
      }
    })
  }
  else {
    logger?.warn?.('Python helper not found, skipping config extraction:', helper)
  }

  let queueName: string | undefined
  let flow: ConfigMeta['flow']

  if (pyConfig) {
    queueName = (pyConfig?.queue && typeof pyConfig.queue === 'object') ? pyConfig.queue?.name : undefined
    const flowCfg = pyConfig?.flow
    if (flowCfg && typeof flowCfg === 'object') {
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
  }

  return { queueName, flow, hasDefaultExport: true }
}
