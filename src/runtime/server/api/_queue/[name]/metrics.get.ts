import { $useQueue } from '../../../utils/useQueue'
import {
  defineEventHandler,
  getRouterParam,
  useRuntimeConfig,
} from '#imports'

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name')

  if(!name) {
    throw 'Queue name is required'
  }

  const { queues } = useRuntimeConfig().queue

  if (!queues[name]) {
    throw `Queue with ${name} not found`
  }

  const { getQueue } = $useQueue()

  const queue = getQueue(name)

  const data = await queue.getMetrics('completed', 0, 10)

  return data
})
