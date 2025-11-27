import { useFlow } from '#imports'

export default defineEventHandler(async (event) => {
  const flow = useFlow()
  const body = await readBody(event)
  
  const result = await flow.startFlow(body.flowName, body.payload)
  
  return result
})
