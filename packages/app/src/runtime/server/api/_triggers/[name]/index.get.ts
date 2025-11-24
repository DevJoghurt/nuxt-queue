import { defineEventHandler, getRouterParam, useTrigger, createError, getRequestURL } from '#imports'

/**
 * Get detailed information about a specific trigger
 * Includes stats, subscriptions, and configuration
 */
export default defineEventHandler(async (event: any) => {
  const name = getRouterParam(event, 'name')

  if (!name) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Trigger name is required',
    })
  }

  const { getTrigger, getSubscribedFlows, getTriggerStats, getAllSubscriptions, getTriggerHistory } = useTrigger()

  // Get the base URL from the request
  const requestURL = getRequestURL(event)
  const baseURL = `${requestURL.protocol}//${requestURL.host}`

  const trigger = getTrigger(name)

  if (!trigger) {
    throw createError({
      statusCode: 404,
      statusMessage: `Trigger '${name}' not found`,
    })
  }

  const subscribedFlows = getSubscribedFlows(name)
  const stats = await getTriggerStats(name)

  // Get detailed subscription info
  const allSubscriptions = getAllSubscriptions()
  const subscriptions = allSubscriptions.filter((sub: any) => sub.triggerName === name)

  // Calculate fires in last 24h from event history
  // Limit to 100 events for performance - enough for most triggers
  const now = Date.now()
  const last24h = now - (24 * 60 * 60 * 1000)
  let fires24h = 0

  try {
    const recentEvents = await getTriggerHistory(name, { limit: 100, types: ['trigger.fired'] })

    if (recentEvents) {
      for (const event of recentEvents) {
        if ((event.ts || 0) >= last24h) {
          fires24h++
        }
      }
    }
  }
  catch {
    // If history fails, just use 0
  }

  // Enhance webhook config with full URL if it's a webhook trigger
  // The actual route is /api/_webhook/trigger/:triggerName
  const webhookConfig = trigger.webhook
    ? {
        ...trigger.webhook,
        path: trigger.webhook.path || `/api/_webhook/trigger/${name}`,
        fullUrl: `${baseURL}/api/_webhook/trigger/${name}`,
      }
    : undefined

  return {
    name: trigger.name,
    type: trigger.type,
    scope: trigger.scope,
    displayName: trigger.displayName,
    description: trigger.description,
    source: trigger.source,
    status: trigger.status || 'active',
    registeredAt: trigger.registeredAt,
    registeredBy: trigger.registeredBy,
    lastActivityAt: trigger.lastActivityAt,
    webhook: webhookConfig,
    schedule: trigger.schedule,
    config: trigger.config,
    version: trigger.version,
    subscribedFlows,
    subscriptions,
    subscriptionCount: subscribedFlows.length,
    stats: {
      totalFires: stats?.totalFires || 0,
      last24h: fires24h,
      successCount: 0, // Not tracked yet
      failureCount: 0, // Not tracked yet
      activeSubscribers: stats?.activeSubscribers || subscribedFlows.length,
      avgResponseTime: 0, // Not tracked yet
      successRate: 100, // Default to 100% since failures not tracked yet
      lastFiredAt: stats?.lastFiredAt,
    },
  }
})
