import { defineEventHandler, useTrigger } from '#imports'

/**
 * Get aggregate trigger statistics
 * Returns overview stats for the triggers page
 */
export default defineEventHandler(async () => {
  const { getAllTriggers, getAllSubscriptions } = useTrigger()

  const triggers = getAllTriggers()
  const subscriptions = getAllSubscriptions()

  // Count by type
  const byType = triggers.reduce((acc: any, trigger: any) => {
    acc[trigger.type] = (acc[trigger.type] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  // Count by scope
  const byScope = triggers.reduce((acc: any, trigger: any) => {
    acc[trigger.scope] = (acc[trigger.scope] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  // Count by status
  const byStatus = triggers.reduce((acc: any, trigger: any) => {
    const status = trigger.status || 'active'
    acc[status] = (acc[status] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  // Calculate total fires from all triggers using fresh stats from store
  const { getTriggerStats } = useTrigger()
  let totalFires = 0

  for (const trigger of triggers) {
    const stats = await getTriggerStats(trigger.name)
    totalFires += stats?.totalFires || 0
  }

  return {
    total: triggers.length,
    byType,
    byScope,
    byStatus,
    totalSubscriptions: subscriptions.length,
    totalFires,
    totalSuccesses: 0, // Not tracked in current stats structure
    totalFailures: 0, // Not tracked in current stats structure
    successRate: '100', // Default to 100% since we don't track failures yet
    entryTriggers: byScope.flow || 0,
    awaitTriggers: byScope.run || 0,
  }
})
