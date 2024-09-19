import {
  defineEventHandler,
  getRouterParam,
  $useWorker,
} from '#imports'

type WorkerData = {
  id: string
  name: string
  paused: boolean
  running: boolean
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') || ''

  const { getWorker } = $useWorker()

  const worker = getWorker(id)

  const data = {
    id: worker.id,
    name: worker.name,
    paused: worker.isPaused(),
    running: worker.isRunning(),
  } as WorkerData

  return data
})
