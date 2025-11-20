import { defineNitroPlugin, $useTriggerRegistry, useNventLogger, useTrigger } from '#imports'
import { getEventBus } from '../../events/eventBus'

/**
 * Trigger Registration Plugin
 *
 * Loads pre-analyzed triggers and subscriptions from build-time registry
 * and registers them via event bus (trigger.registered events).
 * The trigger wiring will handle the actual registration logic.
 *
 * This plugin is ONLY for registering dev/build-time discovered triggers.
 * Trigger wiring and event handling is done in the wiring registry.
 */
export default defineNitroPlugin(async (nitroApp) => {
  // Wait for adapters to be ready
  nitroApp.hooks.hook('nvent:adapters:ready' as any, async () => {
    const logger = useNventLogger('trigger-registration')
    const eventBus = getEventBus()
    const trigger = useTrigger()

    try {
      logger.info('Registering build-time triggers...')

      // Get pre-analyzed trigger registry from build-time template
      const triggerRegistry = $useTriggerRegistry()
      const subscriptions = triggerRegistry?.subscriptions || []
      const triggers = triggerRegistry?.triggers || []

      logger.info(`Found ${triggers.length} triggers and ${subscriptions.length} subscriptions from build`)

      // Only publish events for NEW triggers that don't exist in runtime yet
      // This prevents duplicate events on every restart
      let newTriggers = 0
      for (const triggerData of triggers) {
        // Check if trigger already exists
        if (!trigger.hasTrigger(triggerData.name)) {
          await eventBus.publish({
            type: 'trigger.registered',
            triggerName: triggerData.name,
            data: triggerData,
          } as any)
          newTriggers++
        }
        else {
          logger.debug(`Trigger '${triggerData.name}' already registered, skipping`)
        }
      }

      // Only publish events for NEW subscriptions
      let newSubscriptions = 0
      for (const sub of subscriptions) {
        // Check if subscription already exists
        const existing = trigger.getSubscription(sub.triggerName, sub.flowName)
        if (!existing) {
          await eventBus.publish({
            type: 'subscription.added',
            triggerName: sub.triggerName,
            data: {
              trigger: sub.triggerName,
              flow: sub.flowName,
              mode: sub.mode,
              source: 'build-time',
            },
          } as any)
          newSubscriptions++
        }
        else {
          logger.debug(`Subscription '${sub.flowName}' -> '${sub.triggerName}' already exists, skipping`)
        }
      }

      logger.info(
        `Build-time trigger registration complete `
        + `(${newTriggers} new triggers, ${newSubscriptions} new subscriptions)`,
      )
    }
    catch (error) {
      logger.error('Failed to register build-time triggers', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })
})
