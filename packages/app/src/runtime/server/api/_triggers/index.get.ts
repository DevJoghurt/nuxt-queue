import { defineEventHandler, useTrigger } from '#imports'

/**
 * Get all triggers with their subscriptions and stats
 * Returns comprehensive trigger data for the UI
 */
export default defineEventHandler(async () => {
  const { getAllTriggers, getSubscribedFlows, getTriggerStats } = useTrigger()

  const triggers = getAllTriggers()

  // Enhance each trigger with subscriptions and stats
  const enhancedTriggers = await Promise.all(
    triggers.map(async (trigger: any) => {
      const subscribedFlows = getSubscribedFlows(trigger.name)
      const stats = await getTriggerStats(trigger.name)

      return {
        name: trigger.name,
        type: trigger.type,
        scope: trigger.scope,
        displayName: trigger.displayName,
        description: trigger.description,
        source: trigger.source,
        status: trigger.status || 'active',
        registeredAt: trigger.registeredAt,
        lastActivityAt: trigger.lastActivityAt,
        webhook: trigger.webhook,
        schedule: trigger.schedule,
        config: trigger.config,
        subscribedFlows,
        subscriptionCount: subscribedFlows.length,
        stats: {
          totalFires: stats?.totalFires || 0,
          last24h: 0, // Not tracked yet in current implementation
          successCount: 0, // Not tracked yet
          failureCount: 0, // Not tracked yet
          activeSubscribers: stats?.activeSubscribers || subscribedFlows.length,
          successRate: 100, // Default since failures not tracked yet
          lastFiredAt: stats?.lastFiredAt,
        },
      }
    }),
  )

  return enhancedTriggers
})
