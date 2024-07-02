import { defineEventHandler, getRouterParam, pm2Connect, pm2List } from '#imports'
import { pm2ProcessArray } from '../../../../schema/pm2'


export default defineEventHandler(async (event)=>{
    const name = getRouterParam(event, 'name') || ''

    await pm2Connect()
    const processes = await pm2List()

    const result = await pm2ProcessArray.safeParse(processes)
    if(result.success) 
        return result.data.filter((process)=>process.pm2_env.namespace.startsWith(name))
    else throw 'Error parsing result from process'
})