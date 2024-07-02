import { getRouterParam, pm2Connect, pm2Restart } from '#imports'
import { pm2ProcessArray } from '../../../../schema/pm2'

export default defineEventHandler(async (event)=>{
    const name = getRouterParam(event, 'name') || ''

    await pm2Connect()

    const process = await pm2Restart(name)
    
    const result = await pm2ProcessArray.safeParse(process)
    if(result.success) 
        return result.data[0]
    else throw `Error parsing result from process ${result.error}`
})