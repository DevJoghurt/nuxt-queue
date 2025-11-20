import { defineEventHandler, readBody, createError } from 'h3'
import { useEventManager } from '#imports'

/**
 * Test endpoint for emitting custom events
 * Used to resolve event-based await patterns
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { eventName, payload } = body

  if (!eventName) {
    throw createError({
      statusCode: 400,
      message: 'eventName is required',
    })
  }

  const eventManager = useEventManager()

  // Publish custom event to event bus
  await eventManager.publishBus({
    type: eventName,
    data: payload || {},
  } as any)

  return {
    success: true,
    eventName,
    payload,
    message: 'Event emitted successfully',
  }
})
