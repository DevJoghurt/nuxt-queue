import { defineEventHandler, createError, useStoreAdapter, useStreamTopics } from '#imports'

/**
 * DELETE /api/_flows/:flowName/clear-history
 *
 * Clears all event history for a specific flow.
 * This deletes:
 * - All flow run streams (nq:flow:run-*)
 * - The flow runs index (nq:flows:<flowName>)
 */
export default defineEventHandler(async (event) => {
  const flowName = event.context.params?.name
  if (!flowName) {
    throw createError({ statusCode: 400, statusMessage: 'Flow name required' })
  }

  // Check if adapters are initialized
  let store: any
  let StoreSubjects: any
  try {
    store = useStoreAdapter()
    const topics = useStreamTopics()
    StoreSubjects = topics.StoreSubjects
  }
  catch {
    throw createError({
      statusCode: 503,
      statusMessage: 'Server initializing',
      data: 'Adapters not ready yet, please retry',
    })
  }

  try {
    let deletedStreams = 0
    let deletedIndex = false

    // Get all run IDs from the index using the proper naming convention
    const indexKey = StoreSubjects.flowRunIndex(flowName)

    const runs = await store.index.read(indexKey, { limit: 10000 })

    // Delete each run stream
    if (store.stream.delete) {
      for (const run of runs) {
        const streamName = StoreSubjects.flowRun(run.id)
        await store.stream.delete(streamName)
        deletedStreams++
      }
    }

    // Delete all entries from the index (this also deletes metadata in Redis adapter)
    for (const run of runs) {
      await store.index.delete(indexKey, run.id)
      deletedIndex = true
    }

    return {
      success: true,
      flowName,
      deletedStreams,
      deletedIndex,
    }
  }
  catch (error) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to clear flow history',
      data: error instanceof Error ? error.message : String(error),
    })
  }
})
