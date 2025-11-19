import type { TriggerEntry, TriggerSubscription } from '../../registry/types'
import { useStoreAdapter, useNventLogger, useStreamTopics } from '#imports'
import { getEventBus } from '../events/eventBus'

/**
 * Runtime trigger state
 * Combines file-based config (auto-discovered) + programmatic (runtime)
 */
interface TriggerRuntime {
  // Trigger registry (from registerTrigger)
  triggers: Map<string, TriggerEntry>

  // Subscriptions: Trigger -> Flows
  triggerToFlows: Map<string, Set<TriggerSubscription>>

  // Reverse index: Flow -> Triggers
  flowToTriggers: Map<string, Set<string>>

  // Initialized flag
  initialized: boolean
}

let runtime: TriggerRuntime | null = null

function getTriggerRuntime(): TriggerRuntime {
  if (!runtime) {
    runtime = {
      triggers: new Map(),
      triggerToFlows: new Map(),
      flowToTriggers: new Map(),
      initialized: false,
    }
  }
  return runtime
}

export interface RegisterTriggerOptions {
  name: string
  type: 'event' | 'webhook' | 'schedule' | 'manual'
  scope: 'flow' | 'run'
  displayName?: string
  description?: string
  source?: string

  // Optional validation hints
  expectedSubscribers?: string[]

  // Type-specific config
  webhook?: {
    path: string
    method?: string
    auth?: any
  }
  schedule?: {
    cron: string
    timezone?: string
    enabled?: boolean
  }

  // Schema validation (function allowed here - programmatic)
  schema?: any // Zod schema
  transform?: (data: any) => any

  // Config options
  config?: {
    persistData?: boolean
    retentionDays?: number
    rateLimit?: {
      max: number
      window: number
    }
  }
}

export interface SubscribeTriggerOptions {
  trigger: string
  flow: string
  mode?: 'auto' | 'manual'
  filter?: (data: any) => boolean
  transform?: (data: any) => any
}

/**
 * Core trigger composable
 * Provides runtime API for trigger registration and emission
 */
export function useTrigger() {
  const runtime = getTriggerRuntime()
  const logger = useNventLogger('trigger')
  const store = useStoreAdapter()

  return {
    /**
     * Register a trigger (programmatic)
     */
    async registerTrigger(opts: RegisterTriggerOptions) {
      const { SubjectPatterns } = useStreamTopics()

      // Check if trigger already exists
      const existing = runtime.triggers.get(opts.name)
      if (existing) {
        logger.warn(
          `Trigger '${opts.name}' already registered (${existing.registeredBy}). `
          + `Updating with new configuration.`,
        )
      }

      const entry: TriggerEntry = {
        name: opts.name,
        type: opts.type,
        scope: opts.scope,
        displayName: opts.displayName,
        description: opts.description,
        source: opts.source,
        expectedSubscribers: opts.expectedSubscribers,
        webhook: opts.webhook,
        schedule: opts.schedule,
        registeredAt: existing?.registeredAt || new Date().toISOString(),
        registeredBy: existing?.registeredBy || 'runtime',
      }

      runtime.triggers.set(opts.name, entry)

      // Persist to store using centralized collection name
      await store.save(SubjectPatterns.triggers(), opts.name, {
        ...entry,
        schema: opts.schema?.toString(), // Serialize schema
        transform: opts.transform?.toString(), // Serialize transform
        config: opts.config,
      })

      logger.info(`Registered trigger: ${opts.name} (${opts.type}, ${opts.scope})`)

      // Validate expected subscribers
      if (opts.expectedSubscribers) {
        const actual = runtime.triggerToFlows.get(opts.name)
        for (const expected of opts.expectedSubscribers) {
          const found = Array.from(actual || []).some(
            sub => sub.flowName === expected,
          )
          if (!found) {
            logger.warn(
              `Trigger '${opts.name}' expects subscriber '${expected}' `
              + `but it's not registered`,
            )
          }
        }
      }
    },

    /**
     * Subscribe flow to trigger (programmatic)
     */
    async subscribeTrigger(opts: SubscribeTriggerOptions) {
      const { SubjectPatterns } = useStreamTopics()
      const { trigger, flow, mode = 'auto', filter, transform } = opts

      // Check if subscription already exists
      const existingSubs = runtime.triggerToFlows.get(trigger)
      if (existingSubs) {
        const duplicate = Array.from(existingSubs).find(sub => sub.flowName === flow)
        if (duplicate) {
          logger.warn(
            `Flow '${flow}' is already subscribed to trigger '${trigger}'. `
            + `Updating subscription mode to '${mode}'.`,
          )
          // Remove old subscription
          existingSubs.delete(duplicate)
        }
      }

      const subscription: TriggerSubscription = {
        triggerName: trigger,
        flowName: flow,
        mode,
        source: 'programmatic',
        registeredAt: new Date().toISOString(),
      }

      // Add to trigger -> flows index
      if (!runtime.triggerToFlows.has(trigger)) {
        runtime.triggerToFlows.set(trigger, new Set())
      }
      runtime.triggerToFlows.get(trigger)!.add(subscription)

      // Add to flow -> triggers reverse index
      if (!runtime.flowToTriggers.has(flow)) {
        runtime.flowToTriggers.set(flow, new Set())
      }
      runtime.flowToTriggers.get(flow)!.add(trigger)

      // Persist subscription with filter/transform using centralized collection name
      await store.save(SubjectPatterns.triggerSubscriptions(), `${trigger}:${flow}`, {
        trigger,
        flow,
        mode,
        filter: filter?.toString(),
        transform: transform?.toString(),
        source: 'programmatic',
        registeredAt: new Date().toISOString(),
      })

      logger.info(`Subscribed flow '${flow}' to trigger '${trigger}' (${mode})`)
    },

    /**
     * Unsubscribe flow from trigger
     */
    async unsubscribeTrigger(trigger: string, flow: string) {
      const { SubjectPatterns } = useStreamTopics()

      const subs = runtime.triggerToFlows.get(trigger)
      if (subs) {
        for (const sub of subs) {
          if (sub.flowName === flow) {
            subs.delete(sub)
          }
        }
      }

      const triggers = runtime.flowToTriggers.get(flow)
      if (triggers) {
        triggers.delete(trigger)
      }

      // Remove from store using centralized collection name
      await store.delete(SubjectPatterns.triggerSubscriptions(), `${trigger}:${flow}`)

      logger.info(`Unsubscribed flow '${flow}' from trigger '${trigger}'`)
    },

    /**
     * Emit trigger (fire event)
     * Uses event bus - trigger wiring will handle persistence and flow starts
     */
    async emitTrigger(name: string, data: any) {
      const eventBus = getEventBus()

      // Warn if trigger is not registered (but still allow emission for flexibility)
      if (!runtime.triggers.has(name)) {
        logger.warn(
          `Emitting unregistered trigger '${name}'. `
          + `Consider registering it first with registerTrigger().`,
        )
      }

      // Check if any flows are subscribed
      const subscribedFlows = runtime.triggerToFlows.get(name)
      if (!subscribedFlows || subscribedFlows.size === 0) {
        logger.debug(
          `Trigger '${name}' has no subscribers. Event will be emitted but not processed.`,
        )
      }

      // Publish to event bus - trigger wiring will handle the rest
      await eventBus.publish({
        type: 'trigger.fired',
        triggerName: name,
        data,
      } as any)

      logger.debug(`Emitted trigger: ${name}`)
    },

    /**
     * Query methods
     */

    /**
     * Check if a trigger exists in the registry
     */
    hasTrigger(name: string): boolean {
      return runtime.triggers.has(name)
    },

    /**
     * Get trigger entry by name
     */
    getTrigger(name: string): TriggerEntry | undefined {
      return runtime.triggers.get(name)
    },

    /**
     * Get all registered triggers
     */
    getAllTriggers(): TriggerEntry[] {
      return Array.from(runtime.triggers.values())
    },

    /**
     * Get all flows subscribed to a specific trigger
     */
    getSubscribedFlows(trigger: string): string[] {
      const subs = runtime.triggerToFlows.get(trigger) || new Set()
      return Array.from(subs).map(s => s.flowName)
    },

    /**
     * Get all triggers that a flow is subscribed to
     */
    getFlowTriggers(flow: string): string[] {
      return Array.from(runtime.flowToTriggers.get(flow) || new Set())
    },

    /**
     * Get subscription details for a specific trigger-flow pair
     */
    getSubscription(trigger: string, flow: string): TriggerSubscription | undefined {
      const subs = runtime.triggerToFlows.get(trigger)
      if (!subs) return undefined
      return Array.from(subs).find(s => s.flowName === flow)
    },

    getAllSubscriptions(): TriggerSubscription[] {
      const allSubs: TriggerSubscription[] = []
      for (const subs of runtime.triggerToFlows.values()) {
        allSubs.push(...Array.from(subs))
      }
      return allSubs
    },

    /**
     * Initialize runtime from store (called on startup)
     */
    async initialize() {
      if (runtime.initialized) return

      const { SubjectPatterns } = useStreamTopics()

      logger.info('Initializing trigger runtime...')

      // Load triggers from store using centralized collection names
      if (store.list) {
        const triggers = await store.list(SubjectPatterns.triggers())
        for (const { id, doc } of triggers) {
          runtime.triggers.set(id, doc as TriggerEntry)
        }

        // Load subscriptions from store
        const subscriptions = await store.list(SubjectPatterns.triggerSubscriptions())
        for (const { doc } of subscriptions) {
          const sub = doc as TriggerSubscription & { filter?: string, transform?: string }

          if (!runtime.triggerToFlows.has(sub.triggerName)) {
            runtime.triggerToFlows.set(sub.triggerName, new Set())
          }
          runtime.triggerToFlows.get(sub.triggerName)!.add(sub)

          if (!runtime.flowToTriggers.has(sub.flowName)) {
            runtime.flowToTriggers.set(sub.flowName, new Set())
          }
          runtime.flowToTriggers.get(sub.flowName)!.add(sub.triggerName)
        }

        logger.info(
          `Loaded ${triggers.length} triggers and `
          + `${subscriptions.length} subscriptions from store`,
        )
      }

      runtime.initialized = true
    },

    /**
     * Get runtime state (for debugging)
     */
    getRuntime() {
      return {
        triggerCount: runtime.triggers.size,
        subscriptionCount: Array.from(runtime.triggerToFlows.values())
          .reduce((acc, subs) => acc + subs.size, 0),
        flowCount: runtime.flowToTriggers.size,
        initialized: runtime.initialized,
      }
    },
  }
}
