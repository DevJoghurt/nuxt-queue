import { defineEventHandler, useRuntimeConfig, pm2Connect, pm2Start } from '#imports'
import type { RegisteredWorker } from '../../../../../types'
import { randomUUID } from 'node:crypto'
import { pm2ProcessArray } from '../../../../schema/pm2'

export default defineEventHandler(async (event)=>{
    const name = getRouterParam(event, 'name')

    const { queue } = useRuntimeConfig()

    // @ts-ignore
    const worker = queue.worker.find((worker)=> worker.name === name) as RegisteredWorker

    if(!worker){
        throw `Worker with ${name} not found`
    }

    await pm2Connect()

    const process = await pm2Start({
        name: `${name}_${randomUUID()}`,
        watch: queue.workerWatch,
        script: worker.script,
        cwd: queue.workerRunDir,
        namespace: name
    })
    const result = await pm2ProcessArray.safeParse(process)
    if(result.success) 
        return result.data[0]
    else throw `Error parsing result from process ${result.error}`
})