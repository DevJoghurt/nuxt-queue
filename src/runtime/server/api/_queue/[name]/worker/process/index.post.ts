import { 
    defineEventHandler, 
    getRouterParam, 
    $usePM2,
    resolveWorkerRuntimePath, 
    useRuntimeConfig 
} from '#imports'
import { randomUUID } from 'node:crypto'

export default defineEventHandler(async (event)=>{
    const name = getRouterParam(event, 'name')

    const { runtimeDir, workers } = useRuntimeConfig().queue

    // @ts-ignore
    const w = workers.find((worker)=> worker.name === name)

    if(!w){
        throw `Worker with ${name} not found`
    }

    const { start } = $usePM2()

    const process = await start({
        name: `${w.name}-${randomUUID()}`,
        watch: true,
        script: w.script,
        cwd: resolveWorkerRuntimePath(runtimeDir),
        namespace: w.name
    })

    return process
})