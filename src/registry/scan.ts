import { extname, join, relative } from 'node:path'
import { existsSync, realpathSync } from 'node:fs'
import { globby } from 'globby'
import { useLogger } from '@nuxt/kit'
import type { LayerInfo, WorkerEntry, FlowSource } from './types'
import { loadJsConfig } from './loaders/js'
import { loadTsConfig } from './loaders/ts'
import { loadPyConfig } from './loaders/py'

export async function scanWorkers(layers: LayerInfo[], queuesDir = 'queues'): Promise<{ workers: WorkerEntry[], flowSources: FlowSource[] }> {
  const logger = useLogger()
  const workerByVirtualPath = new Map<string, WorkerEntry>()
  const seenFiles = new Set<string>()
  const flowSources: FlowSource[] = []

  for (const layer of layers) {
    const base = join(layer.serverDir, queuesDir)
    if (!existsSync(base)) continue

    const files = await globby('**/*.{ts,js,mjs,cjs,mts,cts,py}', { cwd: base, dot: false })

    for (const rel of files) {
      const abs = join(base, rel)
      try {
        let key = abs
        try {
          key = realpathSync(abs)
        }
        catch {
          // ignore
        }
        key = key.replace(/\\/g, '/')
        if (seenFiles.has(key)) continue
        seenFiles.add(key)

        const ext = extname(abs).toLowerCase()
        const id = rel.replace(/\.[^.]+$/, '')

        let queueName: string | undefined
        let flow: WorkerEntry['flow'] | undefined

        if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
          const meta = await loadJsConfig(abs)
          queueName = meta.queueName
          flow = meta.flow
          const hasDefaultExport = !!meta.hasDefaultExport
          if (hasDefaultExport) {
            const kind: WorkerEntry['kind'] = 'ts'
            const queueKey = String(queueName || (id.split('/').pop() || id))
            const virtualPath = relative(layer.serverDir, abs).replace(/\\/g, '/')
            workerByVirtualPath.set(virtualPath, {
              id,
              kind,
              filePath: virtualPath,
              absPath: abs,
              exportName: 'default',
              queue: queueKey,
              queueCfg: meta.queueCfg,
              worker: meta.workerOpts,
              flow,
              runtype: meta.runtype,
            })
          }
        }
        else if (ext === '.py') {
          const meta = await loadPyConfig(abs, logger)
          queueName = meta.queueName
          flow = meta.flow
          const kind: WorkerEntry['kind'] = 'py'
          const queueKey = String(queueName || (id.split('/').pop() || id))
          const virtualPath = relative(layer.serverDir, abs).replace(/\\/g, '/')
          workerByVirtualPath.set(virtualPath, {
            id,
            kind,
            filePath: virtualPath,
            absPath: abs,
            exportName: 'default',
            queue: queueKey,
            flow,
          })
        }
        else {
          // TS and variants
          try {
            const meta = await loadTsConfig(abs)
            queueName = meta.queueName
            flow = meta.flow
            const hasDefaultExport = !!meta.hasDefaultExport
            if (hasDefaultExport) {
              const kind: WorkerEntry['kind'] = 'ts'
              const queueKey = String(queueName || (id.split('/').pop() || id))
              const virtualPath = relative(layer.serverDir, abs).replace(/\\/g, '/')
              workerByVirtualPath.set(virtualPath, {
                id,
                kind,
                filePath: virtualPath,
                absPath: abs,
                exportName: 'default',
                queue: queueKey,
                queueCfg: meta.queueCfg,
                worker: meta.workerOpts,
                flow,
                runtype: meta.runtype,
              })
            }
          }
          catch (err) {
            logger.warn('Failed to load TS worker (jiti):', rel, err)
          }
        }

        // default queue fallback
        if (!queueName) {
          queueName = id.split('/').pop() || id
        }

        if (flow) {
          flowSources.push({ flow, queue: String(queueName), id })
        }
      }
      catch (e) {
        logger.warn('Failed to load worker file:', rel, e)
      }
    }
  }

  const workers = Array.from(workerByVirtualPath.values())
  return { workers, flowSources }
}
