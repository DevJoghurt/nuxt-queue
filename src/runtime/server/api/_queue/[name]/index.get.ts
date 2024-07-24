import { 
  defineEventHandler,
  $useQueue
} from '#imports'
import worker from '#worker'
import type { JobCounts, QueueData } from '../../../../types'


export default defineEventHandler(async (event)=>{
  const name = getRouterParam(event, 'name')

  const w = worker.find((worker)=> worker.name === name)

  if(!w){
      throw `Queue with ${name} not found`
  }

  const { getQueue } = $useQueue()

  const queue = getQueue(w.id)

  const data = {} as QueueData

  data.id = queue.name
  data.active = await queue.isPaused() ? false : true
  data.jobs = await queue.getJobCounts() as JobCounts

  return data
})
