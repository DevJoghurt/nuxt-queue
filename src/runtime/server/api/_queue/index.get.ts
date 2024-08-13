import type { JobCounts, QueueData } from '../../../types'
import { $useQueue } from '../../utils/useQueue'
import {
  defineEventHandler,
} from '#imports'

export default defineEventHandler(async () => {
  const { getQueues } = $useQueue()

  const queues = getQueues()

  const data = [] as QueueData[]

  for (const queue of queues) {
    const jobs = await queue.getJobCounts() as JobCounts
    data.push({
      name: queue.name,
      active: await queue.isPaused() ? false : true,
      jobs,
      worker: await queue.getWorkersCount(),
    })
  }

  return data
})
