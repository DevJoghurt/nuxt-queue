import { $usePM2 } from '../../../../../../utils/usePM2'
import {
  defineEventHandler,
  getRouterParam,
} from '#imports'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') || ''

  const { remove } = $usePM2()

  await remove(id)

  return {
    success: true,
  }
})
