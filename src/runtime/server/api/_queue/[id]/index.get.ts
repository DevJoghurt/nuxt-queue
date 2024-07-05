import { 
  defineEventHandler,
  $useQueue
} from '#imports'
import worker from '#worker'
import type { JobCounts, QueueData } from '../../../../types'


export default defineEventHandler(async (event)=>{
  const id = getRouterParam(event, 'id')

  const w = worker.find((worker)=> worker.id === id)

  if(!w){
      throw `Queue with ${id} not found`
  }

  const { getQueue } = $useQueue()

  const queue = getQueue(w.id)

  const data = {} as QueueData

  data.id = queue.name
  data.active = await queue.isPaused() ? false : true
  data.jobs = await queue.getJobCounts() as JobCounts

  return data
})
