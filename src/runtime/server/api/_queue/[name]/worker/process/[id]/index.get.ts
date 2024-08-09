import {
  defineEventHandler,
  getRouterParam,
  $usePM2,
} from '#imports'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') || ''

  const { describe } = $usePM2()

  const process = await describe(id)

  return process
})
