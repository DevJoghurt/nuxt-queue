import { $useQueue } from '#imports'
import {
  defineEventHandler,
  getRouterParam,
  useRuntimeConfig
} from '#imports'

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name')
  const id = getRouterParam(event, 'id')

  if (!name || !id) {
    throw 'Queue name and id is required'
  }


  const { queues } = useRuntimeConfig().queue

  if (!queues[name]) {
    throw `Queue with ${name} not found`
  }

  const { getQueue } = $useQueue()

  const queue = getQueue(name)

  try {
	queue.removeJobScheduler(id)
  } catch (error) {
	throw error
  }

  return {
	statusCode: 200
  }

})