import { randomUUID } from 'node:crypto'
import {
  defineEventHandler,
  getRouterParam,
  $usePM2,
  resolveWorkerRuntimePath,
  useRuntimeConfig,
} from '#imports'

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name')

  const { runtimeDir, workers, redis, queues } = useRuntimeConfig().queue

  // @ts-ignore
  const w = workers.find(worker => worker.name === name)
  const q = queues[name] || {}

  if (!w || !q) {
    throw `Worker with ${name} not found`
  }

  const { start } = $usePM2()

  const env = q.env || {}

  const process = await start({
    name: `${w.name}-${randomUUID()}`,
    watch: runtimeDir === 'build' ? false : true,
    script: w.script,
    cwd: resolveWorkerRuntimePath(runtimeDir),
    namespace: w.name,
    env: {
      REDIS_PORT: redis.port.toString(),
      REDIS_HOST: redis.host,
      ...env,
    },
  })

  return process
})
