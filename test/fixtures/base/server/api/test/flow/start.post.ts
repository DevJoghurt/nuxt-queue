import { useFlowEngine } from '#imports'

export default defineEventHandler(async (event) => {
  const flow = useFlowEngine()
  const body = await readBody(event)
  
  const result = await flow.startFlow(body.flowName, body.payload)
  
  return result
})
