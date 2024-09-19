import {
  defineEventHandler,
  getRouterParam,
  $useWorker
} from '#imports'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') || ''

  const { getWorker } = $useWorker()

  const worker = getWorker(id)

  worker.resume()

  return {
    status: 'success'
  }
})

