import { 
    defineEventHandler, 
    getRouterParam,
    $useQueue
} from '#imports'
import worker from '#worker'

export default defineEventHandler(async (event)=>{
    const id = getRouterParam(event, 'id')

    const w = worker.find((worker)=> worker.id === id)

    if(!w){
        throw `Queue with ${id} not found`
    }

    const { getQueue } = $useQueue()

    const queue = getQueue(w.id)

    const data = await queue.getMetrics('completed')

    return data
})