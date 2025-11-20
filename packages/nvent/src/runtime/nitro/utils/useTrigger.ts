import type { TriggerEntry, TriggerSubscription } from '../../../registry/types'
import { useStoreAdapter, useNventLogger, useStreamTopics } from '#imports'
import { getEventBus } from '../../events/eventBus'

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
     * Uses index + stream architecture (v0.5.1)
     */
    async registerTrigger(opts: RegisterTriggerOptions) {
      const { SubjectPatterns } = useStreamTopics()
      const triggerName = opts.name
      const indexKey = SubjectPatterns.triggerIndex()
      const streamName = SubjectPatterns.trigger(triggerName)

      // Check if trigger already exists
      const existing = runtime.triggers.get(opts.name)
      const isUpdate = !!existing

      if (isUpdate) {
        logger.warn(
          `Trigger '${opts.name}' already registered (${existing.registeredBy}). `
          + `Updating with new configuration.`,
        )
      }

      const now = new Date().toISOString()
      const nowTimestamp = Date.now()

      const entry: TriggerEntry = {
        name: opts.name,
        type: opts.type,
        scope: opts.scope,
        status: 'active',
        displayName: opts.displayName,
        description: opts.description,
        source: opts.source || 'programmatic',
        expectedSubscribers: opts.expectedSubscribers,
        webhook: opts.webhook,
        schedule: opts.schedule,
        registeredAt: existing?.registeredAt || now,
        registeredBy: existing?.registeredBy || 'runtime',
        lastActivityAt: now,
        subscriptions: existing?.subscriptions || {},
        stats: existing?.stats || {
          totalFires: 0,
          activeSubscribers: 0,
        },
        config: opts.config,
        version: (existing?.version || 0) + 1,
      }

      runtime.triggers.set(opts.name, entry)

      if (isUpdate) {
        // Update existing trigger in index
        if (store.indexUpdateWithRetry) {
          await store.indexUpdateWithRetry(indexKey, triggerName, {
            type: opts.type,
            scope: opts.scope,
            displayName: opts.displayName,
            description: opts.description,
            source: opts.source || 'programmatic',
            webhook: opts.webhook,
            schedule: opts.schedule,
            lastActivityAt: now,
            config: opts.config,
            version: entry.version,
          })
        }

        // Append update event to stream
        await store.append(streamName, {
          type: 'trigger.updated',
          triggerName,
          data: {
            changes: {
              type: opts.type,
              scope: opts.scope,
              displayName: opts.displayName,
              description: opts.description,
              config: opts.config,
            },
          },
        })
      }
      else {
        // Add new trigger to index
        if (store.indexAdd) {
          await store.indexAdd(indexKey, triggerName, nowTimestamp, {
            'name': opts.name,
            'type': opts.type,
            'scope': opts.scope,
            'status': 'active',
            'displayName': opts.displayName,
            'description': opts.description,
            'source': opts.source || 'programmatic',
            'registeredAt': now,
            'registeredBy': 'runtime',
            'lastActivityAt': now,
            'stats.totalFires': 0,
            'stats.activeSubscribers': 0,
            'webhook': opts.webhook,
            'schedule': opts.schedule,
            'config': opts.config,
            'version': 1,
          })
        }

        // Append registration event to stream
        await store.append(streamName, {
          type: 'trigger.registered',
          triggerName,
          data: {
            type: opts.type,
            scope: opts.scope,
            displayName: opts.displayName,
            description: opts.description,
            source: opts.source || 'programmatic',
            config: opts.config,
          },
        })
      }

      logger.info(`${isUpdate ? 'Updated' : 'Registered'} trigger: ${opts.name} (${opts.type}, ${opts.scope})`)

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
     * Uses index + stream architecture (v0.5.1)
     */
    async subscribeTrigger(opts: SubscribeTriggerOptions) {
      const { SubjectPatterns } = useStreamTopics()
      const { trigger, flow, mode = 'auto', filter: _filter, transform: _transform } = opts
      const indexKey = SubjectPatterns.triggerIndex()
      const streamName = SubjectPatterns.trigger(trigger)
      const now = new Date().toISOString()

      // Check if subscription already exists
      const existingSubs = runtime.triggerToFlows.get(trigger)
      const isUpdate = existingSubs && Array.from(existingSubs).some(sub => sub.flowName === flow)

      if (isUpdate) {
        logger.warn(
          `Flow '${flow}' is already subscribed to trigger '${trigger}'. `
          + `Updating subscription mode to '${mode}'.`,
        )
        // Remove old subscription from runtime
        for (const sub of existingSubs!) {
          if (sub.flowName === flow) {
            existingSubs!.delete(sub)
            break
          }
        }
      }

      const subscription: TriggerSubscription = {
        triggerName: trigger,
        flowName: flow,
        mode,
        source: 'programmatic',
        registeredAt: now,
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

      // Update trigger index with embedded subscription
      if (store.indexUpdateWithRetry) {
        await store.indexUpdateWithRetry(indexKey, trigger, {
          [`subscriptions.${flow}.mode`]: mode,
          [`subscriptions.${flow}.subscribedAt`]: now,
          lastActivityAt: now,
        })

        // Increment subscriber count if this is a new subscription
        if (!isUpdate && store.indexIncrement) {
          await store.indexIncrement(indexKey, trigger, 'stats.activeSubscribers', 1)
        }
      }

      // Append subscription event to trigger stream
      await store.append(streamName, {
        type: 'subscription.added',
        triggerName: trigger,
        data: {
          flowName: flow,
          mode,
          isUpdate,
        },
      })

      logger.info(`${isUpdate ? 'Updated' : 'Subscribed'} flow '${flow}' to trigger '${trigger}' (${mode})`)
    },

    /**
     * Unsubscribe flow from trigger
     * Uses index + stream architecture (v0.5.1)
     */
    async unsubscribeTrigger(trigger: string, flow: string) {
      const { SubjectPatterns } = useStreamTopics()
      const indexKey = SubjectPatterns.triggerIndex()
      const streamName = SubjectPatterns.trigger(trigger)
      const now = new Date().toISOString()

      // Remove from runtime indices
      const subs = runtime.triggerToFlows.get(trigger)
      if (subs) {
        for (const sub of subs) {
          if (sub.flowName === flow) {
            subs.delete(sub)
            break
          }
        }
      }

      const triggers = runtime.flowToTriggers.get(flow)
      if (triggers) {
        triggers.delete(trigger)
      }

      // Update trigger index - remove subscription (atomic operations)
      if (store.indexUpdateWithRetry) {
        await store.indexUpdateWithRetry(indexKey, trigger, {
          [`subscriptions.${flow}`]: null, // null removes the field
          lastActivityAt: now,
        })

        // Decrement subscriber count atomically
        if (store.indexIncrement) {
          await store.indexIncrement(indexKey, trigger, 'stats.activeSubscribers', -1)
        }
      }

      // Append unsubscribe event to trigger stream
      await store.append(streamName, {
        type: 'subscription.removed',
        triggerName: trigger,
        data: {
          flowName: flow,
        },
      })

      logger.info(`Unsubscribed flow '${flow}' from trigger '${trigger}'`)
    },

    /**
     * Emit trigger (fire event)
     * Uses index + stream architecture (v0.5.1)
     * Updates statistics and publishes to event bus
     */
    async emitTrigger(name: string, data: any) {
      const { SubjectPatterns } = useStreamTopics()
      const eventBus = getEventBus()
      const indexKey = SubjectPatterns.triggerIndex()
      const streamName = SubjectPatterns.trigger(name)
      const now = new Date().toISOString()
      const nowTimestamp = Date.now()

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

      // Update trigger statistics in index (atomic operations)
      if (store.indexUpdateWithRetry) {
        await store.indexUpdateWithRetry(indexKey, name, {
          ['stats.lastFiredAt']: now,
          ['lastActivityAt']: now,
        })
      }

      // Increment fire count atomically
      if (store.indexIncrement) {
        await store.indexIncrement(indexKey, name, 'stats.totalFires', 1)
      }

      // Append fire event to trigger stream (summary only, no full payload)
      await store.append(streamName, {
        type: 'trigger.fired',
        triggerName: name,
        data: {
          timestamp: nowTimestamp,
          subscribersCount: subscribedFlows?.size || 0,
        },
      })

      // Publish to event bus - trigger wiring will handle flow starts with full data
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
     * Uses index + stream architecture (v0.5.1)
     */
    async initialize() {
      if (runtime.initialized) return

      const { SubjectPatterns } = useStreamTopics()
      const indexKey = SubjectPatterns.triggerIndex()

      logger.info('Initializing trigger runtime from index...')

      // Load triggers from index
      if (store.indexRead) {
        const entries = await store.indexRead(indexKey, { limit: 1000 })

        let activeCount = 0
        let totalSubscriptions = 0

        for (const entry of entries) {
          const metadata = entry.metadata as any

          // Only load active triggers into runtime
          if (metadata.status === 'active') {
            const triggerEntry: TriggerEntry = {
              name: metadata.name,
              type: metadata.type,
              scope: metadata.scope,
              status: metadata.status,
              displayName: metadata.displayName,
              description: metadata.description,
              source: metadata.source,
              registeredAt: metadata.registeredAt,
              registeredBy: metadata.registeredBy,
              lastActivityAt: metadata.lastActivityAt,
              subscriptions: metadata.subscriptions || {},
              stats: metadata.stats || { totalFires: 0, activeSubscribers: 0 },
              webhook: metadata.webhook,
              schedule: metadata.schedule,
              config: metadata.config,
              version: metadata.version || 1,
            }

            runtime.triggers.set(entry.id, triggerEntry)
            activeCount++

            // Load embedded subscriptions
            if (metadata.subscriptions) {
              for (const [flowName, subData] of Object.entries(metadata.subscriptions)) {
                const subscription: TriggerSubscription = {
                  triggerName: entry.id,
                  flowName,
                  mode: (subData as any).mode || 'auto',
                  source: 'programmatic',
                  registeredAt: (subData as any).subscribedAt,
                }

                // Add to trigger -> flows index
                if (!runtime.triggerToFlows.has(entry.id)) {
                  runtime.triggerToFlows.set(entry.id, new Set())
                }
                runtime.triggerToFlows.get(entry.id)!.add(subscription)

                // Add to flow -> triggers reverse index
                if (!runtime.flowToTriggers.has(flowName)) {
                  runtime.flowToTriggers.set(flowName, new Set())
                }
                runtime.flowToTriggers.get(flowName)!.add(entry.id)

                totalSubscriptions++
              }
            }
          }
        }

        logger.info(
          `Loaded ${activeCount} active triggers with ${totalSubscriptions} subscriptions from index`,
        )
      }
      else {
        // Fallback to old doc-based loading for backward compatibility
        logger.warn('Store does not support indexRead, falling back to doc-based loading')

        if (store.list) {
          // Use deprecated patterns for backward compatibility
          const triggers = await store.list('triggers')
          for (const { id, doc } of triggers) {
            runtime.triggers.set(id, doc as TriggerEntry)
          }

          // Load subscriptions from store
          const subscriptions = await store.list('trigger-subscriptions')
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
            + `${subscriptions.length} subscriptions from doc store (legacy)`,
          )
        }
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

    /**
     * Retire a trigger (mark as inactive)
     * v0.5.1: New lifecycle management method
     */
    async retireTrigger(name: string, reason: string = 'Manual retirement') {
      const { SubjectPatterns } = useStreamTopics()
      const indexKey = SubjectPatterns.triggerIndex()
      const streamName = SubjectPatterns.trigger(name)
      const now = new Date().toISOString()
      const nowTimestamp = Date.now()

      // Get current trigger metadata
      const trigger = runtime.triggers.get(name)
      if (!trigger) {
        logger.warn(`Cannot retire non-existent trigger: ${name}`)
        return
      }

      // Get full metadata from index for final stats
      let finalStats = trigger.stats
      if (store.indexGet) {
        const entry = await store.indexGet(indexKey, name)
        if (entry?.metadata) {
          finalStats = (entry.metadata as any).stats || finalStats
        }
      }

      // Update index
      if (store.indexUpdateWithRetry) {
        await store.indexUpdateWithRetry(indexKey, name, {
          status: 'retired',
          retiredAt: now,
          retiredReason: reason,
          lastActivityAt: now,
        })
      }

      // Append retirement event to stream
      await store.append(streamName, {
        type: 'trigger.retired',
        triggerName: name,
        data: {
          reason,
          finalStats: finalStats || { totalFires: 0, activeSubscribers: 0 },
          activeFor: nowTimestamp - new Date(trigger.registeredAt).getTime(),
        },
      })

      // Remove from runtime (but keep in index for history)
      runtime.triggers.delete(name)
      runtime.triggerToFlows.delete(name)

      // Clean up reverse index
      for (const [flow, triggers] of runtime.flowToTriggers.entries()) {
        triggers.delete(name)
        if (triggers.size === 0) {
          runtime.flowToTriggers.delete(flow)
        }
      }

      logger.info(`Retired trigger: ${name} (reason: ${reason})`)
    },

    /**
     * Get trigger statistics
     * v0.5.1: New analytics method
     */
    async getTriggerStats(name: string) {
      const { SubjectPatterns } = useStreamTopics()
      const indexKey = SubjectPatterns.triggerIndex()

      if (!store.indexGet) {
        // Fallback to runtime data
        const trigger = runtime.triggers.get(name)
        return trigger?.stats
      }

      const entry = await store.indexGet(indexKey, name)
      if (!entry?.metadata) return null

      return (entry.metadata as any).stats
    },

    /**
     * Get trigger history from stream
     * v0.5.1: New analytics method
     */
    async getTriggerHistory(name: string, opts?: { limit?: number, types?: string[] }) {
      const { SubjectPatterns } = useStreamTopics()
      const streamName = SubjectPatterns.trigger(name)

      const events = await store.read(streamName, {
        limit: opts?.limit || 100,
        types: opts?.types,
        order: 'desc',
      })

      return events
    },
  }
}
