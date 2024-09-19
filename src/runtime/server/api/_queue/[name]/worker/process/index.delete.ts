import {
  defineEventHandler,
  getRouterParam,
  $useWorker,
} from '#imports'

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name') || ''

  const { closeWorker } = $useWorker()

  await closeWorker(name)

  return {
    success: true,
  }
})
