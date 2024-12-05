import {
  defineEventHandler,
  getRouterParam,
  useRuntimeConfig,
  $useWorker,
} from '#imports'

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name')

  if(!name) {
    throw 'Worker name is required'
  }

  const { workers, queues } = useRuntimeConfig().queue

  // @ts-ignore
  const w = workers.find(worker => worker.name === name)
  const q = queues[name] || {}

  if (!w || !q) {
    throw `Worker with ${name} not found`
  }

  const { createWorker } = $useWorker()

  createWorker(name, w.script)

  return {
    status: 'success',
  }
})
