import { defineEventHandler } from '#imports'

export default defineEventHandler(()=>{

    const runtime = useRuntimeConfig()

    return runtime.queue.worker
})