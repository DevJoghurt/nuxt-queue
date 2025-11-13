import { defineEventHandler, getRouterParam, createError, readBody, useFlowEngine } from '#imports'

export default defineEventHandler(async (event) => {
  const flowName = getRouterParam(event, 'name')
  if (!flowName) throw createError({ statusCode: 400, statusMessage: 'Flow name is required' })

  const { startFlow } = useFlowEngine()
  const body = await readBody(event)
  const result = await startFlow(flowName, body || {})
  return result
})
