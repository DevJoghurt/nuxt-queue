import { defineEventHandler, getRouterParam, useFlows } from '#imports'

export default defineEventHandler(async (event) => {
  const flowName = getRouterParam(event, 'name')
  const runId = getRouterParam(event, 'id')
  if (!flowName || !runId) return null
  const { getFlowRunSnapshot } = useFlows()
  const snap = await getFlowRunSnapshot(flowName, runId)
  return snap
})
