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

  const { runtimeDir, workers, redis } = useRuntimeConfig().queue

  // @ts-ignore
  const w = workers.find(worker => worker.name === name)

  if (!w) {
    throw `Worker with ${name} not found`
  }

  const { start } = $usePM2()

  const process = await start({
    name: `${w.name}-${randomUUID()}`,
    watch: runtimeDir === 'build' ? false : true,
    script: w.script,
    cwd: resolveWorkerRuntimePath(runtimeDir),
    namespace: w.name,
    env: {
      REDIS_PORT: redis.port.toString(),
      REDIS_HOST: redis.host,
    },
  })

  return process
})
