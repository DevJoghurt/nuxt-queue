import { 
  defineEventHandler,
  $useQueue,
  useRuntimeConfig
} from '#imports'
import type { JobCounts, QueueData } from '../../../../types'


export default defineEventHandler(async (event)=>{
  const name = getRouterParam(event, 'name') || ''

  const { queues } = useRuntimeConfig().queue

  if(!queues[name]){
      throw `Queue with ${name} not found`
  }

  const { getQueue } = $useQueue()

  const queue = getQueue(name)

  const data = {} as QueueData

  data.name = queue.name
  data.active = await queue.isPaused() ? false : true
  data.jobs = await queue.getJobCounts() as JobCounts
  data.worker = await queue.getWorkersCount()

  return data
})
