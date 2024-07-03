import { getRouterParam, pm2Connect, pm2Describe } from '#imports'
import { pm2ProcessArray } from '../../../../schema/pm2'

export default defineEventHandler(async (event)=>{
    const id = getRouterParam(event, 'id') || ''

    await pm2Connect()

    const process = await pm2Describe(id)

    const result = await pm2ProcessArray.safeParse(process)
    if(result.success) 
        return result.data[0]
    else throw `Error parsing result from process ${result.error}`
})