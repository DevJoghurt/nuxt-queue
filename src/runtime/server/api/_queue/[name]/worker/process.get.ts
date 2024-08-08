import {
  defineEventHandler,
  $usePM2,
} from '#imports'

export default defineEventHandler(async () => {
  const { list } = $usePM2()

  const processes = await list()

  return processes
})
