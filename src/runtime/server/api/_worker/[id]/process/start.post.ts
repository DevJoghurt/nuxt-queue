import { 
    defineEventHandler, 
    getRouterParam, 
    $usePM2, 
    useRuntimeConfig } from '#imports'
import { randomUUID } from 'node:crypto'
import worker from '#worker'

export default defineEventHandler(async (event)=>{
    const id = getRouterParam(event, 'id')

    const { runtimeDir } = useRuntimeConfig().queue

    // @ts-ignore
    const w = worker.find((worker)=> worker.id === id)

    if(!w){
        throw `Worker with ${name} not found`
    }

    const { start } = $usePM2()

    const process = await start({
        name: `${w.id}-${randomUUID()}`,
        watch: true,
        script: w.script,
        cwd: runtimeDir,
        namespace: w.id
    })

    return process
})