import {
  getRouterParam,
  $usePM2,
} from '#imports'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') || ''

  const { restart } = $usePM2()

  const process = await restart(id)

  return process
})
