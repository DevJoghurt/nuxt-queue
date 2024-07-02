import { defineEventHandler, getRouterParam } from '#imports'


export default defineEventHandler(async (event)=>{
    const runtime = useRuntimeConfig()
    const name = getRouterParam(event, 'name')

    return runtime.queue.worker.find((worker)=>worker.name === name)
})