import {
  defineEventHandler,
  getRouterParam,
  $usePM2,
} from '#imports'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') || ''

  const { stop } = $usePM2()

  const process = await stop(id)

  return process
})
