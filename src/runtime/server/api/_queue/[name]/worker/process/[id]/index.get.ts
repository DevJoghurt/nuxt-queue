import { $usePM2 } from '../../../../../../utils/usePM2'
import {
  defineEventHandler,
  getRouterParam,
} from '#imports'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') || ''

  const { describe } = $usePM2()

  const process = await describe(id)

  return process
})
