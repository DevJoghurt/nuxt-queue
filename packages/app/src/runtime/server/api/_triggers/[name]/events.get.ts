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
  const offset = query.offset ? Number.parseInt(query.offset as string, 10) : 0
  const types = query.types ? (query.types as string).split(',') : undefined

  // First, get total count by fetching a large number (or all)
  const allEventsForCount = await getTriggerHistory(name, {
    limit: 10000, // Large number to get all events for counting
    types,
  })
  
  const totalCount = allEventsForCount?.length || 0

  // Then get the actual paginated events
  const allEvents = await getTriggerHistory(name, {
    limit: Math.min(limit + offset, 1000), // Fetch enough to cover offset + limit
    types,
  })

  // Apply offset and limit on the results
  const events = allEvents?.slice(offset, offset + limit) || []
  
  return {
    triggerName: name,
    events,
    count: events.length,
    total: totalCount, // Actual total count of all events matching filter
    hasMore: offset + limit < totalCount, // More data available if offset+limit < total
  }
})
