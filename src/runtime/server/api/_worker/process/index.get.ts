import { defineEventHandler, pm2Connect, pm2List } from '#imports'
import { pm2ProcessArray } from '../../../schema/pm2'

export default defineEventHandler(async ({})=>{
    await pm2Connect()
    const list = await pm2List()

    const result = await pm2ProcessArray.safeParse(list)
    if(result.success) 
        return result.data
    else throw `Error parsing result from process ${result.error}`
})