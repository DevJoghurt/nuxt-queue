import { defineEventHandler, $useQueue } from '#imports'
import worker  from '#worker'

export default defineEventHandler(async ()=>{

    const workerList = []

    const { getQueues } = $useQueue()

    const queues = getQueues()

    //count active processes
    for(const q of queues){
        const worker = await q.getWorkers()
        workerList.push(...worker)
    }

    return workerList
})