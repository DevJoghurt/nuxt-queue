import { defineEventHandler, getRouterParam, useFlows } from '#imports'

export default defineEventHandler(async (event) => {
  const flowName = getRouterParam(event, 'name')
  const runId = getRouterParam(event, 'id')
  if (!flowName || !runId) return 'missing params'
  const flows = useFlows()
  const steps = await flows.getFlowStepSnapshots(String(runId))
  return steps
})
