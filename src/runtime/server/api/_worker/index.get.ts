import { defineEventHandler } from '#imports'
import worker  from '#worker'

export default defineEventHandler(()=>{

    return worker
})