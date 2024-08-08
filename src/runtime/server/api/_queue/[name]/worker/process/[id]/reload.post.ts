import {
  getRouterParam,
  $usePM2,
} from '#imports'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') || ''

  const { reload } = $usePM2()

  const process = await reload(id)

  return process
})
