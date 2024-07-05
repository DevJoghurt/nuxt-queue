import { 
    defineEventHandler,
    $useQueue
  } from '#imports'
import type { JobCounts, QueueData } from '../../../types'


export default defineEventHandler(async (event)=>{

    const { getQueues } = $useQueue()

    const queues = getQueues()

    const data = [] as QueueData[]

    for(const queue of queues){
      const jobs = await queue.getJobCounts() as JobCounts
       data.push({
        id: queue.name,
        active: await queue.isPaused() ? false : true,
        jobs
      })
    }

    return data
})
