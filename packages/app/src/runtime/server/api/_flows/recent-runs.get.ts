import { defineEventHandler, getQuery, useStoreAdapter, useNventLogger, useStreamTopics, $useAnalyzedFlows } from '#imports'

/**
 * GET /api/_flows/recent-runs
 *
 * Returns a list of recent flow runs across all flows.
 *
 * Query params:
 * - limit: number (default: 10)
 *
 * Returns:
 * {
 *   runs: Array<{ id, flowName, status, createdAt, ... }>
 * }
 */
export default defineEventHandler(async (event) => {
  const logger = useNventLogger('api-flows-recent-runs')
  const query = getQuery(event)
  const limit = Math.min(Number.parseInt(query.limit as string) || 10, 50)

  // Prevent caching - always fetch fresh data
  event.node.res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
  event.node.res.setHeader('Pragma', 'no-cache')

  // Check if adapters are initialized
  let store: any
  let StoreSubjects: any
  let flows: any
  try {
    store = useStoreAdapter()
    const topics = useStreamTopics()
    StoreSubjects = topics.StoreSubjects
    flows = $useAnalyzedFlows() as any
  }
  catch (err) {
    logger.error('[flows/recent-runs] Adapters not initialized yet:', { error: err })
    return {
      error: 'Server initializing',
      message: 'Please retry in a moment',
    }
  }

  try {
    const flowsList = flows || []

    // Collect recent runs from each flow
    const allRuns: any[] = []

    for (const flow of flowsList) {
      try {
        // Use flow.id instead of flow.name
        const flowName = flow.id || flow.name
        const runIndexKey = StoreSubjects.flowRunIndex(flowName)
        const entries = await store.indexRead(runIndexKey, { offset: 0, limit: 5 })

        // Map to include flow name and details
        const flowRuns = entries.map((entry: any) => ({
          id: entry.id,
          flowName: flowName,
          flowDisplayName: flow.displayName || flowName,
          status: entry.metadata?.status || 'unknown',
          createdAt: entry.score, // timestamp
          startedAt: entry.metadata?.startedAt,
          completedAt: entry.metadata?.completedAt,
          stepCount: entry.metadata?.stepCount || 0,
          completedSteps: entry.metadata?.completedSteps || 0,
        }))

        allRuns.push(...flowRuns)
      }
      catch (err) {
        // Skip flows that have no runs yet
        const flowName = flow.id || flow.name
        logger.debug(`No runs found for flow ${flowName}`, { error: err })
      }
    }

    // Sort by createdAt descending (most recent first)
    allRuns.sort((a, b) => b.createdAt - a.createdAt)

    // Return top N
    const recentRuns = allRuns.slice(0, limit)

    return {
      count: recentRuns.length,
      items: recentRuns.map(run => ({
        ...run,
        createdAt: new Date(run.createdAt).toISOString(),
        startedAt: run.startedAt ? new Date(run.startedAt).toISOString() : undefined,
        completedAt: run.completedAt ? new Date(run.completedAt).toISOString() : undefined,
      })),
    }
  }
  catch (err) {
    logger.error('[flows/recent-runs] error:', { error: err })
    return {
      error: 'Failed to list recent runs',
      message: err instanceof Error ? err.message : String(err),
    }
  }
})
