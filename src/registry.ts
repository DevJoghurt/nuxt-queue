import { relative, join, extname, dirname } from 'node:path'
import { globby } from 'globby'
import { useLogger } from '@nuxt/kit'
import { existsSync, readFileSync, writeFileSync, realpathSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'
import jiti from 'jiti'

export type LayerInfo = {
  rootDir: string
  serverDir: string
}

type WorkerEntry = {
  id: string
  kind: 'ts' | 'py'
  filePath: string
  absPath: string
  exportName?: string
  queue: string
  // Optional per-worker runtype override for TS runner isolation (e.g., 'inprocess' | 'task')
  runtype?: 'inprocess' | 'task'
  flow?: {
    id: string
    role: 'main' | 'step'
    step: string | string[]
    emits?: string[]
    triggers?: string[]
  }
}

type FlowMain = {
  step: string
  queue: string
  workerId: string
}

type FlowStep = {
  queue: string
  workerId: string
  triggers?: string[]
}

type FlowsIndex = Record<string, {
  main?: FlowMain
  steps: Record<string, FlowStep>
}>

type EventIndexEntry = {
  flowId: string
  step: string
  queue: string
  workerId: string
}

type EventIndex = Record<string, Array<EventIndexEntry>>

export async function compileRegistryFromServerWorkers(layers: LayerInfo[], queuesDir = 'queues') {
  const logger = useLogger()
  // Map by virtual file path (relative to serverDir), so later layers override earlier ones
  const workerByVirtualPath = new Map<string, WorkerEntry>()
  // Track real file paths we've already processed to avoid duplicates via symlinks or aliasing
  const seenFiles = new Set<string>()
  // Collect flow metadata from any file (including config-only) to build flows separately from workers
  const flowSources: Array<{ flow: NonNullable<WorkerEntry['flow']>, queue: string, id: string }> = []

  for (const layer of layers) {
    const base = join(layer.serverDir, queuesDir)
    if (!existsSync(base)) continue
    const files = await globby('**/*.{ts,js,mjs,cjs,mts,cts,py}', { cwd: base, dot: false })
    for (const rel of files) {
      try {
        const abs = join(base, rel)
        let key = abs
        try {
          key = realpathSync(abs)
        }
        catch {
          // ignore realpath errors and use original absolute path
        }
        key = key.replace(/\\/g, '/')
        if (seenFiles.has(key)) continue
        seenFiles.add(key)
        const ext = extname(abs).toLowerCase()

        // derive id from path: remove extension
        const id = rel.replace(/\.[^.]+$/, '')

        // JS runtime import, TS fallback to magicast; Python sidecar JSON
        let queueName: string | undefined
        let flow: WorkerEntry['flow'] | undefined

        if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
          const mod = await import(pathToFileURL(abs).href)
          queueName = typeof mod.queue === 'string' ? mod.queue : undefined
          const cfg = mod.config
          if (!queueName && cfg && typeof cfg.queue === 'string') {
            queueName = cfg.queue
          }
          const flowCfg = cfg?.flow
          // Per-worker runtype override for TS runner isolation
          const isolate: any = cfg?.runner?.ts?.isolate || cfg?.runner?.isolate || cfg?.isolate
          const runtypeOverride = isolate === 'task' ? 'task' : (isolate === 'inprocess' ? 'inprocess' : undefined)
          if (flowCfg) {
            const triggers = Array.isArray(flowCfg.triggers)
              ? flowCfg.triggers
              : (typeof flowCfg.triggers === 'string' ? [flowCfg.triggers] : undefined)
            flow = {
              id: flowCfg.id,
              role: flowCfg.role,
              step: flowCfg.step,
              emits: flowCfg.emits,
              triggers,
            }
          }
          // Only consider as a worker if there's a default export
          const isWorker = !!(mod && mod.default)
          if (isWorker) {
            const kind: WorkerEntry['kind'] = 'ts'
            const queueKey = String(queueName || (id.split('/').pop() || id))
            const virtualPath = relative(layer.serverDir, abs).replace(/\\/g, '/')
            workerByVirtualPath.set(virtualPath, { id, kind, filePath: virtualPath, absPath: abs, exportName: 'default', queue: queueKey, flow, runtype: runtypeOverride })
          }
        }
        else if (ext === '.py') {
          // Python: Try to load config via helper script; fallback to sidecar JSON
          const moduleDir = dirname(fileURLToPath(import.meta.url))
          let helper = join(moduleDir, 'runtime', 'python', 'get_config.py')
          const helperContent = `import sys\nimport json\nimport importlib.util\nimport os\nimport platform\n\n\ndef send_message(payload):\n    bytes_message = (json.dumps(payload) + "\\n").encode("utf-8")\n    if platform.system() == "Windows":\n        sys.stdout.buffer.write(bytes_message)\n        sys.stdout.buffer.flush()\n    else:\n        fd = int(os.environ["NODE_CHANNEL_FD"])\n        os.write(fd, bytes_message)\n\n\nasync def run_python_module(file_path: str) -> None:\n    try:\n        module_dir = os.path.dirname(os.path.abspath(file_path))\n        if module_dir not in sys.path:\n            sys.path.insert(0, module_dir)\n        spec = importlib.util.spec_from_file_location(os.path.splitext(os.path.basename(file_path))[0], file_path)\n        if spec is None or spec.loader is None:\n            raise ImportError(f"Could not load module from {file_path}")\n        module = importlib.util.module_from_spec(spec)\n        module.__package__ = os.path.basename(module_dir)\n        spec.loader.exec_module(module)\n        if not hasattr(module, "config"):\n            raise AttributeError(f"No 'config' found in module {file_path}")\n        cfg = getattr(module, "config")\n        if isinstance(cfg, dict) and "middleware" in cfg:\n            del cfg["middleware"]\n        send_message(cfg)\n    except Exception as error:\n        print("Error running Python module:", str(error), file=sys.stderr)\n        sys.exit(1)\n\n\nif __name__ == "__main__":\n    if len(sys.argv) < 2:\n        sys.exit(1)\n    file_path = sys.argv[1]\n    import asyncio\n    asyncio.run(run_python_module(file_path))\n`
          if (!existsSync(helper)) {
            try {
              const tempPath = join(tmpdir(), 'nuxt_queue_get_config.py')
              writeFileSync(tempPath, helperContent, 'utf-8')
              helper = tempPath
            }
            catch (e) {
              logger.debug('Failed to write temp python helper', e)
            }
          }
          let pyConfig: any | undefined

          if (existsSync(helper)) {
            pyConfig = await new Promise<any | undefined>((resolve) => {
              try {
                const child = spawn('python3', [helper, abs], {
                  stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
                  env: { ...process.env, NODE_CHANNEL_FD: '3' },
                })

                let dataBuf = ''
                // stdio[3] is the extra pipe (NODE_CHANNEL_FD like)
                const fd = child.stdio[3]
                const stream = (fd as any) || child.stdout
                stream.setEncoding('utf-8')
                stream.on('data', (chunk: string) => {
                  dataBuf += chunk
                })
                child.on('error', () => resolve(undefined))
                child.on('close', () => {
                  // Expect a single JSON line
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

          if (!pyConfig) {
            const dir = dirname(abs)
            const baseName = rel.replace(/\.[^.]+$/, '')
            const candidates = [join(dir, `${baseName}.flow.json`), join(dir, `${baseName}.config.json`)]
            let sidecar: any
            for (const c of candidates) {
              if (existsSync(c)) {
                try {
                  sidecar = JSON.parse(readFileSync(c, 'utf-8'))
                  break
                }
                catch (e) {
                  logger.warn('Failed to parse sidecar config for', rel, e)
                }
              }
            }
            pyConfig = sidecar
          }

          if (pyConfig) {
            queueName = typeof pyConfig.queue === 'string' ? pyConfig.queue : undefined
            const flowCfg = pyConfig?.flow
            if (flowCfg && typeof flowCfg === 'object') {
              const triggers = Array.isArray(flowCfg.triggers)
                ? flowCfg.triggers
                : (typeof flowCfg.triggers === 'string' ? [flowCfg.triggers] : undefined)
              flow = {
                id: flowCfg.id,
                role: flowCfg.role,
                step: flowCfg.step,
                emits: flowCfg.emits,
                triggers,
              }
            }
          }
        }
        else {
          // TS/TS variants: use jiti only
          try {
            // Stub auto-imported helpers so requiring config doesn't throw
            const prevDQW = (globalThis as any).defineQueueWorker
            const prevDQC = (globalThis as any).defineQueueConfig
            ;(globalThis as any).defineQueueWorker = (meta: any, processor: any) => processor
            ;(globalThis as any).defineQueueConfig = (cfg: any) => cfg
            const load = jiti(import.meta.url)
            const mod = load(abs)
            // restore
            ;(globalThis as any).defineQueueWorker = prevDQW
            ;(globalThis as any).defineQueueConfig = prevDQC

            queueName = typeof mod.queue === 'string' ? mod.queue : undefined
            const cfg = mod.config
            if (!queueName && cfg && typeof cfg.queue === 'string') {
              queueName = cfg.queue
            }
            const flowCfg = cfg?.flow
            // Per-worker runtype override for TS runner isolation
            const isolate: any = cfg?.runner?.ts?.isolate || cfg?.runner?.isolate || cfg?.isolate
            const runtypeOverride = isolate === 'task' ? 'task' : (isolate === 'inprocess' ? 'inprocess' : undefined)
            if (flowCfg) {
              const triggers = Array.isArray(flowCfg.triggers)
                ? flowCfg.triggers
                : (typeof flowCfg.triggers === 'string' ? [flowCfg.triggers] : undefined)
              flow = {
                id: flowCfg.id,
                role: flowCfg.role,
                step: flowCfg.step,
                emits: flowCfg.emits,
                triggers,
              }
            }
            // Add as worker only if there's a default export
            if (mod && mod.default) {
              const kind: WorkerEntry['kind'] = 'ts'
              const queueKey = String(queueName || (id.split('/').pop() || id))
              const virtualPath = relative(layer.serverDir, abs).replace(/\\/g, '/')
              workerByVirtualPath.set(virtualPath, { id, kind, filePath: virtualPath, absPath: abs, exportName: 'default', queue: queueKey, flow, runtype: runtypeOverride })
            }
          }
          catch (err) {
            logger.warn('Failed to load TS worker (jiti):', rel, err)
          }
        }

        if (!queueName) {
          queueName = id.split('/').pop() || id
        }
        // Collect flow metadata for later even if not a worker
        if (flow) {
          flowSources.push({ flow, queue: String(queueName), id })
        }
        // For Python, treat as worker always (no static default export semantics)
        if (ext === '.py') {
          const kind: WorkerEntry['kind'] = 'py'
          const queueKey = String(queueName)
          const virtualPath = relative(layer.serverDir, abs).replace(/\\/g, '/')
          workerByVirtualPath.set(virtualPath, { id, kind, filePath: virtualPath, absPath: abs, exportName: 'default', queue: queueKey, flow })
        }
      }
      catch (e) {
        logger.warn('Failed to load worker file:', rel, e)
      }
    }
  }

  // Finalize workers array after deduplication
  const workers = Array.from(workerByVirtualPath.values())
  // Build flows index and event index from collected flowSources (includes config-only files and workers with flow)
  const flows: FlowsIndex = {}
  const eventIndex: EventIndex = {}
  const seenFlowKeys = new Set<string>()
  for (const src of flowSources) {
    const { flow: f, queue, id } = src
    if (!f?.id || !f.step) continue
    if (!flows[f.id]) flows[f.id] = { steps: {} }
    const rawSteps = Array.isArray(f.step) ? f.step : [f.step]
    const steps = rawSteps.filter((s): s is string => typeof s === 'string' && s.length > 0)
    if (steps.length === 0) continue
    const bucket = (flows[f.id] = flows[f.id] || { steps: {} })
    if (f.role === 'main') {
      // If multiple steps are provided for a main role, pick the first for bucket.main
      const mainStep = steps[0]!
      const key = `${f.id}:${f.role}:${mainStep}`
      if (!seenFlowKeys.has(key)) {
        seenFlowKeys.add(key)
        bucket.main = { step: mainStep as string, queue, workerId: id }
      }
      // Remaining steps (if any) are added as normal steps
      for (const s of steps.slice(1)) {
        const skey = `${f.id}:step:${s}`
        if (seenFlowKeys.has(skey)) continue
        seenFlowKeys.add(skey)
        bucket.steps[s] = { queue, workerId: id, triggers: f.triggers }
      }
    }
    else {
      for (const s of steps) {
        const skey = `${f.id}:${f.role}:${s}`
        if (seenFlowKeys.has(skey)) continue
        seenFlowKeys.add(skey)
        bucket.steps[s] = { queue, workerId: id, triggers: f.triggers }
      }
    }
    if (f.triggers) {
      for (const kind of f.triggers) {
        if (!eventIndex[kind]) eventIndex[kind] = []
        for (const s of steps) {
          eventIndex[kind].push({ flowId: f.id, step: s, queue, workerId: id })
        }
      }
    }
  }

  const compiled = {
    workers,
    flows,
    eventIndex,
  }

  return compiled
}
