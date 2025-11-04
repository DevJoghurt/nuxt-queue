import { defineEventHandler, createError, useStreamStore } from '#imports'

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

  try {
    const store = useStreamStore()
    const names = store.names()

    let deletedStreams = 0
    let deletedIndex = false

    // Get all run IDs from the index using the proper naming convention
    const indexKey = names.flowIndex(flowName)

    if (store.indexRead) {
      const runs = await store.indexRead(indexKey, { limit: 10000 })

      // Delete each run stream using the proper naming convention
      if (store.deleteStream) {
        for (const run of runs) {
          const streamName = names.flow(run.id)
          await store.deleteStream(streamName)
          deletedStreams++
        }
      }
    }

    // Delete the index
    if (store.deleteIndex) {
      await store.deleteIndex(indexKey)
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
    console.error('[clear-history] error:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to clear flow history',
      data: error instanceof Error ? error.message : String(error),
    })
  }
})
