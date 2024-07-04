import { 
    defineEventHandler, 
    getRouterParam, 
    $usePM2 
} from '#imports'


export default defineEventHandler(async (event)=>{
    const id = getRouterParam(event, 'id') || ''

    const { list } = $usePM2()

    const processes = await list()

    return processes.filter((process)=>process.namespace === id)
})