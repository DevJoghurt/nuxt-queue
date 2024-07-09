import { defineEventHandler, $usePM2 } from '#imports'
import worker  from '#worker'

export default defineEventHandler(async ()=>{

    const { list } = $usePM2()

    const processes = await list()

    //count active processes
    for(const w of worker){
        w.processes = processes.filter(p=>p.namespace === w.id).length
    }

    return worker
})