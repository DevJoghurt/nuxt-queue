import { defineEventHandler, getRouterParam } from '#imports'
import worker from '#worker'

export default defineEventHandler(async (event)=>{
    const id = getRouterParam(event, 'id')
    
    return worker.find((w)=>w.id === id)
})