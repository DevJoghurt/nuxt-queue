import { defineEventHandler, getRouterParam, useRuntimeConfig } from '#imports'
import { Queue } from 'bullmq'
import worker from '#worker'

export default defineEventHandler(async (event)=>{
    const id = getRouterParam(event, 'id')

    const { redis } = useRuntimeConfig().queue

    // @ts-ignore
    const w = worker.find((worker)=> worker.id === id)

    if(!w){
        throw `Queue with ${id} not found`
    }

    const queue = new Queue(w.id, {
        connection: {
            ...redis
        }
    })
    await queue.add('wall', { color: 'pink' })
})