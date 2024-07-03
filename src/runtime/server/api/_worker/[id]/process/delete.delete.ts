import { defineEventHandler, getRouterParam, pm2Connect, pm2List, pm2Delete } from '#imports'
import { pm2ProcessArray } from '../../../../schema/pm2'


export default defineEventHandler(async (event)=>{
    const id = getRouterParam(event, 'id') || ''

    await pm2Connect()
    const processes = await pm2List()

    const result = await pm2ProcessArray.safeParse(processes)
    if(result.success) {
        const processes = result.data.filter((process)=>process.namespace === id)
        for(const process of processes){
            await pm2Delete(process.id)
        }
        return {
            success: true
        }
    } else{
        throw 'Error parsing result from process'
    }
})