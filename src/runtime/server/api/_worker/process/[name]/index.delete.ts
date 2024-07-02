import { getRouterParam, pm2Connect, pm2Delete } from '#imports'
import { pm2ProcessArray } from '../../../../schema/pm2'

export default defineEventHandler(async (event)=>{
    const name = getRouterParam(event, 'name') || ''

    await pm2Connect()

    const process = await pm2Delete(name)
    
    const result = await pm2ProcessArray.safeParse(process)
    if(result.success) 
        return {
            success: true
        }
    else throw `Error parsing result from process ${result.error}`
})