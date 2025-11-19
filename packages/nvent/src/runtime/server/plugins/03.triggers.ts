import { defineNitroPlugin, $useTriggerRegistry, useTrigger, useNventLogger } from '#imports'
import { setupTriggerWiring, setupAwaitWiring } from '../../events/wiring/triggerWiring'

/**
 * Trigger System Initialization Plugin
 *
 * Phase 4: Integration
 * - Loads pre-analyzed trigger subscriptions from build-time registry
 * - Initializes trigger runtime and wiring
 * - Sets up event listeners
 */
export default defineNitroPlugin(async (nitroApp) => {
  // Wait for adapters to be ready
  nitroApp.hooks.hook('nvent:adapters:ready' as any, async () => {
    const logger = useNventLogger('trigger-init')
    const trigger = useTrigger()

    try {
      logger.info('Initializing trigger system...')

      // Get pre-analyzed trigger registry from build-time template
      // @ts-ignore - generated at build time
      const triggerRegistry = $useTriggerRegistry()
      const subscriptions = triggerRegistry?.subscriptions || []
      const index = triggerRegistry?.index || { triggerToFlows: {}, flowToTriggers: {} }

      logger.info(`Loaded ${subscriptions.length} trigger subscriptions from registry`)
      logger.debug('Trigger index loaded', {
        triggers: Object.keys(index.triggerToFlows).length,
        flows: Object.keys(index.flowToTriggers).length,
      })

      // Register subscriptions in runtime
      for (const sub of subscriptions) {
        await trigger.subscribeTrigger({
          trigger: sub.triggerName,
          flow: sub.flowName,
          mode: sub.mode,
        })
      }

      // Setup event wiring
      await setupTriggerWiring()
      await setupAwaitWiring()

      logger.info('Trigger system initialized successfully')
    }
    catch (error) {
      logger.error('Failed to initialize trigger system', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })

  // Cleanup on close
  nitroApp.hooks.hook('close', async () => {
    // Trigger runtime cleanup if needed
    // (Currently no cleanup needed as runtime state is in-memory)
  })
})
