import { defineEventHandler, getRouterParam, $useQueue } from '#imports'

export default defineEventHandler(async (event)=>{
    const name = getRouterParam(event, 'name') || ''

    const { getQueue } = $useQueue()

    const queue = getQueue(name)
    
    return await queue.getWorkers()
})