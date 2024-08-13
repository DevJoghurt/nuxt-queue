import { $useQueue } from '../../../../utils/useQueue'
import {
  defineEventHandler,
  getRouterParam,
  useRuntimeConfig,
} from '#imports'

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name')

  const { queues } = useRuntimeConfig().queue

  if (!queues[name]) {
    throw `Queue with ${name} not found`
  }

  const { getQueue } = $useQueue()

  const queue = getQueue(name)

  await queue.add('wall', { color: 'pink' })
})
