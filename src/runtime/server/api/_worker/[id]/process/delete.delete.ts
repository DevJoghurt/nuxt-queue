import { 
    defineEventHandler, 
    getRouterParam, 
    $usePM2 
} from '#imports'


export default defineEventHandler(async (event)=>{
    const id = getRouterParam(event, 'id') || ''

    const { list, remove } = $usePM2()

    const allProcesses = await list()
    const processes = allProcesses.filter((process)=>process.namespace === id)

    for(const process of processes){
        await remove(process.id)
    }

    return {
        success: true
    }
})