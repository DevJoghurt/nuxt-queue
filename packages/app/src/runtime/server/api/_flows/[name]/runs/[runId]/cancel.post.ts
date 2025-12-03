import { defineEventHandler, getRouterParam, createError, useFlow } from '#imports'

export default defineEventHandler(async (event) => {
  const flowName = getRouterParam(event, 'name')
  const runId = getRouterParam(event, 'runId')

  if (!flowName || !runId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Flow name and run ID are required',
    })
  }

  const flowEngine = useFlow()

  try {
    const result = await flowEngine.cancelFlow(flowName, runId)
    return result
  }
  catch (error: any) {
    throw createError({
      statusCode: 500,
      statusMessage: `Failed to cancel flow: ${error.message}`,
    })
  }
})
