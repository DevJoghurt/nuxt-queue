import { 
    defineEventHandler,
    $useQueue
  } from '#imports'
import worker from '#worker'
import { JobSchemaArray } from '../../../../../schema'


export default defineEventHandler(async (event)=>{
    const id = getRouterParam(event, 'id')

    const w = worker.find((worker)=> worker.id === id)
  
    if(!w){
        throw `Queue with ${id} not found`
    }

    const { getQueue } = $useQueue()

    const queue = getQueue(w.id)
  
    const jobs = await queue.getJobs()

    for(const job of jobs){
        job.state = await queue.getJobState(job.id)
    }

    const result = await JobSchemaArray.safeParse(jobs)
    if(result.success) 
        return result.data
    else
        throw `Job data parsing error ${result.error}`
})