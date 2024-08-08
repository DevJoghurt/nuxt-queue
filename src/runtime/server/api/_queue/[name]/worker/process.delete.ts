import {
  defineEventHandler,
  $usePM2,
} from '#imports'

export default defineEventHandler(async () => {
  const { list, remove } = $usePM2()

  const processes = await list()

  for (const process of processes) {
    await remove(process.id)
  }

  return {
    success: true,
  }
})
