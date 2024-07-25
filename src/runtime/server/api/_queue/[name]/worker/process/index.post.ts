import { 
    defineEventHandler, 
    getRouterParam, 
    $usePM2, 
    useRuntimeConfig } from '#imports'
import { randomUUID } from 'node:crypto'
import worker from '#worker'

export default defineEventHandler(async (event)=>{
    const name = getRouterParam(event, 'name')

    const { runtimeDir } = useRuntimeConfig().queue

    // @ts-ignore
    const w = worker.find((worker)=> worker.name === name)

    if(!w){
        throw `Worker with ${name} not found`
    }

    const { start } = $usePM2()

    const process = await start({
        name: `${w.name}-${randomUUID()}`,
        watch: true,
        script: w.script,
        cwd: runtimeDir,
        namespace: w.name
    })

    return process
})