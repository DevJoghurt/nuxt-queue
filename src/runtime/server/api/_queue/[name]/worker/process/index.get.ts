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
  runtype: 'spawn' | 'worker' | 'intern'
}

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name') || ''

  const { getWorkerInstances } = $useWorker()

  const res = [] as WorkerData[]
  const workerData = {} as WorkerData
  const workers = getWorkerInstances(name)

  for(const w of workers) {
    workerData.id = w.id
    workerData.name = name
    workerData.paused = w.processor.isPaused()
    workerData.running = w.processor.isRunning()
    workerData.runtype = w.runtype
    res.push(workerData)
  }

  return res
})
