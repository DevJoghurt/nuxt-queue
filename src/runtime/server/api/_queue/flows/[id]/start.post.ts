import { defineEventHandler, getRouterParam, createError, readBody } from '#imports'
import { $useFlowEngine } from '../../../../utils/useFlowEngine'

export default defineEventHandler(async (event) => {
  const flowId = getRouterParam(event, 'id')
  if (!flowId) throw createError({ statusCode: 400, statusMessage: 'Flow id is required' })

  const { startFlow } = $useFlowEngine()
  const body = await readBody(event)
  const result = await startFlow(flowId, body || {})
  return result
})
