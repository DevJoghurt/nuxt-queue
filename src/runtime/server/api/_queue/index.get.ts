import type { JobCounts, QueueData } from '../../../types'
import { $useQueue } from '../../utils/useQueue'
import {
  defineEventHandler,
  useRuntimeConfig,
} from '#imports'

export default defineEventHandler(async () => {
  const { getQueues } = $useQueue()
  const { queues } = useRuntimeConfig().queue

  const registeredQueues = getQueues()

  const data = [] as QueueData[]

  for (const queue of registeredQueues) {
    const jobs = await queue.getJobCounts() as JobCounts
    data.push({
      name: queue.name,
      active: await queue.isPaused() ? false : true,
      jobs,
      origin: queues[queue.name]?.origin,
      worker: await queue.getWorkersCount(),
    })
  }

  return data
})
