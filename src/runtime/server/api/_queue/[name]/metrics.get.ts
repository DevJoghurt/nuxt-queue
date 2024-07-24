import { 
    defineEventHandler, 
    getRouterParam,
    $useQueue
} from '#imports'
import worker from '#worker'

export default defineEventHandler(async (event)=>{
    const name = getRouterParam(event, 'name')

    const w = worker.find((worker)=> worker.name === name)

    if(!w){
        throw `Queue with ${name} not found`
    }

    const { getQueue } = $useQueue()

    const queue = getQueue(w.name)

    const data = await queue.getMetrics('completed')

    return data
})