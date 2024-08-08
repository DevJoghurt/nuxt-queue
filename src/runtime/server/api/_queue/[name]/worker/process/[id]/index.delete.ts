import {
  getRouterParam,
  $usePM2,
} from '#imports'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') || ''

  const { remove } = $usePM2()

  await remove(id)

  return {
    success: true,
  }
})
