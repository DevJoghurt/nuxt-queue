import {
  defineEventHandler,
  getRouterParam,
  $useWorker
} from '#imports'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') || ''

  const { closeWorker } = $useWorker()

  await closeWorker(id)

  return {
    success: true,
  }
})
