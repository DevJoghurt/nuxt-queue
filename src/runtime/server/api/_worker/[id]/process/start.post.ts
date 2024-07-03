import { defineEventHandler, getRouterParam, pm2Connect, pm2Start, useRuntimeConfig } from '#imports'
import { randomUUID } from 'node:crypto'
import { pm2ProcessArray } from '../../../../schema/pm2'
import worker from '#worker'

export default defineEventHandler(async (event)=>{
    const id = getRouterParam(event, 'id')

    const { runtimeDir } = useRuntimeConfig().queue

    // @ts-ignore
    const w = worker.find((worker)=> worker.id === id)

    if(!w){
        throw `Worker with ${name} not found`
    }

    await pm2Connect()

    const process = await pm2Start({
        name: `${w.id}-${randomUUID()}`,
        watch: true,
        script: w.script,
        cwd: runtimeDir,
        namespace: w.id
    })
    const result = await pm2ProcessArray.safeParse(process)
    if(result.success) 
        return result.data[0]
    else throw `Error parsing result from process ${result.error}`
})