import { $usePM2 } from '../../../../../../utils/usePM2'
import {
  defineEventHandler,
  getRouterParam,
} from '#imports'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') || ''

  const { stop } = $usePM2()

  const process = await stop(id)

  return process
})
