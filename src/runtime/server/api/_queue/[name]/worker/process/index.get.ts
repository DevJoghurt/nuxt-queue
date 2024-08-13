import { $usePM2 } from '../../../../../utils/usePM2'
import {
  defineEventHandler,
  getRouterParam,
} from '#imports'

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name') || ''

  const { list } = $usePM2()

  const processes = await list()

  return processes.filter(process => process.namespace === name)
})
