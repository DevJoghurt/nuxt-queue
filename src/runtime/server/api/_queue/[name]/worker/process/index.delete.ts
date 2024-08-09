import {
  defineEventHandler,
  getRouterParam,
  $usePM2,
} from '#imports'

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name') || ''

  const { list, remove } = $usePM2()

  const allProcesses = await list()
  const processes = allProcesses.filter(process => process.namespace === name)

  for (const process of processes) {
    await remove(process.id)
  }

  return {
    success: true,
  }
})