import { defineNitroPlugin, $useTriggerRegistry, useNventLogger } from '#imports'
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

    try {
      logger.info('Registering build-time triggers...')

      // Get pre-analyzed trigger registry from build-time template
      const triggerRegistry = $useTriggerRegistry()
      const subscriptions = triggerRegistry?.subscriptions || []
      const triggers = triggerRegistry?.triggers || []

      logger.info(`Found ${triggers.length} triggers and ${subscriptions.length} subscriptions from build`)

      // Publish trigger.registered events for each discovered trigger
      // The trigger wiring will handle the actual registration
      for (const trigger of triggers) {
        await eventBus.publish({
          type: 'trigger.registered',
          triggerName: trigger.name,
          data: trigger,
        } as any)
      }

      // Publish subscription.registered events
      // The trigger wiring will handle subscribing flows to triggers
      for (const sub of subscriptions) {
        await eventBus.publish({
          type: 'subscription.registered',
          data: {
            trigger: sub.triggerName,
            flow: sub.flowName,
            mode: sub.mode,
            source: 'build-time',
          },
        } as any)
      }

      logger.info('Build-time trigger registration complete')
    }
    catch (error) {
      logger.error('Failed to register build-time triggers', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })
})
