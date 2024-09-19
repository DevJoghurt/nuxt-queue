import {
  defineEventHandler,
  getRouterParam,
  $useWorker,
} from '#imports'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') || ''

  const { getWorker } = $useWorker()

  const worker = getWorker(id)

  await worker.pause()

  return {
    status: 'success',
  }
})
