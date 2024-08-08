import {
  defineEventHandler,
  getRouterParam,
  $usePM2,
} from '#imports'

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name') || ''

  const { list } = $usePM2()

  const processes = await list()

  return processes.filter(process => process.namespace === name)
})
