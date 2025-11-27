import type { TriggerEntry, TriggerSubscription } from '../../../registry/types'
import { useStoreAdapter, useNventLogger, useStreamTopics } from '#imports'
import { getEventBus } from '../../events/eventBus'
import { getTriggerRuntime } from '../../events/utils/triggerRuntime'

/**
 * Public export for resolving payload references
 * Allows external code to resolve references if needed
 */
export async function resolvePayload(data: any): Promise<any> {
  const logger = useNventLogger('trigger')
  const store = useStoreAdapter()
  const runtime = getTriggerRuntime(store, logger)
  return runtime.resolvePayload(data)
}

export interface RegisterTriggerOptions {
  name: string
  type: 'event' | 'webhook' | 'schedule' | 'manual'
  scope: 'flow' | 'run'
  status?: 'active' | 'inactive' | 'retired'
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
    payloadThreshold?: number // Bytes - default 10KB (10 * 1024)
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
  const logger = useNventLogger('trigger')
  const store = useStoreAdapter()
  const runtime = getTriggerRuntime(store, logger)

  return {
    /**
     * Register a trigger (programmatic)
     * Publishes event to bus - triggerWiring handles persistence and orchestration
     */
    async registerTrigger(opts: RegisterTriggerOptions) {
      const eventBus = getEventBus()
      const existing = runtime.getTrigger(opts.name)
      const isUpdate = !!existing

      if (isUpdate) {
        logger.info(`Updating trigger: ${opts.name}`)
        // Publish trigger.updated event
        await eventBus.publish({
          type: 'trigger.updated',
          triggerName: opts.name,
          data: {
            type: opts.type,
            scope: opts.scope,
            status: opts.status,
            displayName: opts.displayName,
            description: opts.description,
            source: opts.source || 'programmatic',
            webhook: opts.webhook,
            schedule: opts.schedule,
            config: opts.config,
            expectedSubscribers: opts.expectedSubscribers,
          },
        } as any)
      }
      else {
        logger.info(`Registering trigger: ${opts.name}`)
        // Publish trigger.registered event
        await eventBus.publish({
          type: 'trigger.registered',
          triggerName: opts.name,
          data: {
            name: opts.name,
            type: opts.type,
            scope: opts.scope,
            displayName: opts.displayName,
            description: opts.description,
            source: opts.source || 'programmatic',
            expectedSubscribers: opts.expectedSubscribers,
            webhook: opts.webhook,
            schedule: opts.schedule,
            config: opts.config,
          },
        } as any)
      }
    },

    /**
     * Subscribe flow to trigger (programmatic)
     * Publishes event to bus - triggerWiring handles persistence and orchestration
     */
    async subscribeTrigger(opts: SubscribeTriggerOptions) {
      const eventBus = getEventBus()
      const { trigger, flow, mode = 'auto' } = opts

      const existingSub = runtime.getSubscription(trigger, flow)
      const isUpdate = !!existingSub

      logger.info(`${isUpdate ? 'Updating' : 'Subscribing'} flow '${flow}' to trigger '${trigger}' (${mode})`)

      // Publish subscription.added event
      await eventBus.publish({
        type: 'subscription.added',
        triggerName: trigger,
        data: {
          trigger,
          flow,
          mode,
          isUpdate,
        },
      } as any)
    },

    /**
     * Unsubscribe flow from trigger
     * Publishes event to bus - triggerWiring handles persistence and orchestration
     */
    async unsubscribeTrigger(trigger: string, flow: string) {
      const eventBus = getEventBus()

      logger.info(`Unsubscribing flow '${flow}' from trigger '${trigger}'`)

      // Publish subscription.removed event
      await eventBus.publish({
        type: 'subscription.removed',
        triggerName: trigger,
        data: {
          trigger,
          flow,
        },
      } as any)
    },

    /**
     * Emit trigger (fire event)
     * Publishes event to bus - triggerWiring handles persistence, stats, and orchestration
     *
     * Large payloads are automatically stored in KV store and replaced with references
     * to keep stream events small and memory-efficient.
     */
    async emitTrigger(name: string, data: any, opts?: { payloadThreshold?: number }) {
      const eventBus = getEventBus()
      const trigger = runtime.getTrigger(name)

      // Warn if trigger is not registered (but still allow emission for flexibility)
      if (!trigger) {
        logger.warn(
          `Emitting unregistered trigger '${name}'. `
          + `Consider registering it first with registerTrigger().`,
        )
      }

      // Check payload threshold
      const threshold = opts?.payloadThreshold
        || trigger?.config?.payloadThreshold
        || 10 * 1024 // 10KB default

      // Handle large payloads
      const eventData = await runtime.handleLargePayload(name, data, threshold)

      logger.debug(`Emitting trigger: ${name}`, {
        hasReference: !!eventData.__payloadRef,
        size: eventData.__size,
      })

      // Publish trigger.fired event with reference (or original if small)
      await eventBus.publish({
        type: 'trigger.fired',
        triggerName: name,
        data: eventData,
      } as any)
    },

    /**
     * Query methods
     */

    /**
     * Check if a trigger exists in the registry
     */
    hasTrigger(name: string): boolean {
      return runtime.hasTrigger(name)
    },

    /**
     * Get trigger entry by name
     */
    getTrigger(name: string): TriggerEntry | undefined {
      return runtime.getTrigger(name)
    },

    /**
     * Get all registered triggers
     * @param options - Sorting and pagination options
     */
    getAllTriggers(options?: {
      sortBy?: 'registeredAt' | 'lastActivityAt' | 'name'
      order?: 'asc' | 'desc'
      limit?: number
      offset?: number
    }): TriggerEntry[] {
      return runtime.getAllTriggers(options)
    },

    /**
     * Get all flows subscribed to a specific trigger
     */
    getSubscribedFlows(trigger: string): string[] {
      return runtime.getSubscribedFlows(trigger)
    },

    /**
     * Get all triggers that a flow is subscribed to
     */
    getFlowTriggers(flow: string): string[] {
      return runtime.getFlowTriggers(flow)
    },

    /**
     * Get subscription details for a specific trigger-flow pair
     */
    getSubscription(trigger: string, flow: string): TriggerSubscription | undefined {
      return runtime.getSubscription(trigger, flow)
    },

    getAllSubscriptions(): TriggerSubscription[] {
      return runtime.getAllSubscriptions()
    },

    /**
     * Initialize runtime from store (called on startup)
     * Uses index + stream architecture (v0.5.1)
     */
    async initialize() {
      if (runtime.initialized) return

      const { StoreSubjects } = useStreamTopics()
      const indexKey = StoreSubjects.triggerIndex()

      logger.info('Initializing trigger runtime from index...')

      // Load triggers from index
      if (store.index.read) {
        const entries = await store.index.read(indexKey, { limit: 1000 })

        let activeCount = 0
        let totalSubscriptions = 0

        for (const entry of entries) {
          const metadata = entry.metadata as any

          // Load all triggers into runtime (active and inactive for visibility)
          const triggerEntry: TriggerEntry = {
            name: metadata.name,
            type: metadata.type,
            scope: metadata.scope,
            status: metadata.status || 'active',
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

          runtime.addTrigger(entry.id, triggerEntry)
          if (metadata.status === 'active') {
            activeCount++
          }

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

              runtime.addSubscription(entry.id, flowName, subscription)
              totalSubscriptions++
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
            runtime.addTrigger(id, doc as TriggerEntry)
          }

          // Load subscriptions from store
          const subscriptions = await store.list('trigger-subscriptions')
          for (const { doc } of subscriptions) {
            const sub = doc as TriggerSubscription & { filter?: string, transform?: string }
            runtime.addSubscription(sub.triggerName, sub.flowName, sub)
          }

          logger.info(
            `Loaded ${triggers.length} triggers and `
            + `${subscriptions.length} subscriptions from doc store (legacy)`,
          )
        }
      }

      runtime.setInitialized(true)
    },

    /**
     * Get runtime state (for debugging)
     */
    getRuntime() {
      return runtime.getRuntimeStats()
    },

    /**
     * Delete a trigger completely (removes all data)
     * Publishes event to bus - triggerWiring handles persistence and orchestration
     */
    async deleteTrigger(name: string) {
      const eventBus = getEventBus()
      const trigger = runtime.getTrigger(name)

      if (!trigger) {
        logger.warn(`Cannot delete non-existent trigger: ${name}`)
        return
      }

      logger.info(`Deleting trigger: ${name}`)

      // Publish trigger.deleted event
      await eventBus.publish({
        type: 'trigger.deleted',
        triggerName: name,
        data: {},
      } as any)
    },

    /**
     * Update trigger status (active/inactive/retired)
     * For future status management UI
     */
    async updateTriggerStatus(name: string, status: 'active' | 'inactive' | 'retired') {
      const eventBus = getEventBus()
      const trigger = runtime.getTrigger(name)

      if (!trigger) {
        logger.warn(`Cannot update status of non-existent trigger: ${name}`)
        return
      }

      logger.info(`Updating trigger ${name} status to: ${status}`)

      // Publish trigger.updated event with status change
      await eventBus.publish({
        type: 'trigger.updated',
        triggerName: name,
        data: {
          ...trigger,
          status,
        },
      } as any)
    },

    /**
     * Get trigger statistics
     * v0.5.1: New analytics method
     */
    async getTriggerStats(name: string) {
      const { StoreSubjects } = useStreamTopics()
      const indexKey = StoreSubjects.triggerIndex()

      if (!store.index.get) {
        // Fallback to runtime data
        const trigger = runtime.getTrigger(name)
        return trigger?.stats
      }

      const entry = await store.index.get(indexKey, name)
      if (!entry?.metadata) return null

      return (entry.metadata as any).stats
    },

    /**
     * Get trigger history from stream
     * v0.5.1: New analytics method
     */
    async getTriggerHistory(name: string, opts?: { limit?: number, types?: string[] }) {
      const { StoreSubjects } = useStreamTopics()
      const streamName = StoreSubjects.triggerStream(name)

      const events = await store.stream.read(streamName, {
        limit: opts?.limit || 100,
        types: opts?.types,
        order: 'desc',
      })

      return events
    },
  }
}
