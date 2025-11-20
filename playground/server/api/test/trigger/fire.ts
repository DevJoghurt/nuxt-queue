import { defineEventHandler, readBody } from 'h3'
import { useTrigger } from '#imports'

/**
 * Test endpoint for manually firing triggers
 * Used for testing trigger-based flows
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { triggerName, data } = body

  if (!triggerName) {
    throw createError({
      statusCode: 400,
      message: 'triggerName is required',
    })
  }

  const trigger = useTrigger()

  // Fire the trigger (publishes trigger.fired event)
  await trigger.emitTrigger(triggerName, data || {})

  // Get subscribed flows for response
  const subscribedFlows = trigger.getSubscribedFlows(triggerName)

  return {
    success: true,
    triggerName,
    data,
    subscribedFlows,
    message: `Trigger fired. ${subscribedFlows.length} flow(s) will start.`,
  }
})
