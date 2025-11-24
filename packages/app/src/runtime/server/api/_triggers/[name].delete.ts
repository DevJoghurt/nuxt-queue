import { defineEventHandler, getRouterParam, useTrigger } from '#imports'

/**
 * DELETE /api/_triggers/:name
 *
 * Delete a trigger
 */
export default defineEventHandler(async (event) => {
  const logger = {
    info: console.log,
    error: console.error,
  }
  const trigger = useTrigger()
  const name = getRouterParam(event, 'name')

  if (!name) {
    return {
      error: 'Missing trigger name',
      statusCode: 400,
    }
  }

  try {
    logger.info('Deleting trigger', { name })

    // Check if trigger exists
    if (!trigger.hasTrigger(name)) {
      return {
        error: 'Trigger not found',
        statusCode: 404,
      }
    }

    // Delete the trigger completely (removes all data)
    await trigger.deleteTrigger(name)

    logger.info(`Successfully deleted trigger '${name}'`)

    return {
      success: true,
      message: `Trigger '${name}' deleted successfully`,
    }
  }
  catch (err) {
    logger.error('Failed to delete trigger', { error: err })
    return {
      error: 'Failed to delete trigger',
      message: err instanceof Error ? err.message : String(err),
      statusCode: 500,
    }
  }
})
