import { defineEventHandler, getRouterParam, getQuery, useTrigger, createError } from '#imports'

/**
 * Get trigger event history
 * Returns events from the trigger stream with pagination
 */
export default defineEventHandler(async (event: any) => {
  const name = getRouterParam(event, 'name')
  const query = getQuery(event)

  if (!name) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Trigger name is required',
    })
  }

  const { getTrigger, getTriggerHistory } = useTrigger()

  const trigger = getTrigger(name)

  if (!trigger) {
    throw createError({
      statusCode: 404,
      statusMessage: `Trigger '${name}' not found`,
    })
  }

  // Parse query parameters
  const limit = query.limit ? Number.parseInt(query.limit as string, 10) : 50
  const types = query.types ? (query.types as string).split(',') : undefined

  // Get events from stream
  const events = await getTriggerHistory(name, {
    limit: Math.min(limit, 500), // Max 500 events per request
    types,
  })

  return {
    triggerName: name,
    events: events || [],
    count: events?.length || 0,
    hasMore: events?.length === limit,
  }
})
