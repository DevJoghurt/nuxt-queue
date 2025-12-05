import type { EventRecord } from '../../adapters/interfaces/store'
import type { TriggerFiredEvent } from '../types'
import type { TriggerEntry, TriggerSubscription } from '../../../registry/types'
import { getEventBus } from '../eventBus'
import { useTrigger, useNventLogger, useStoreAdapter, useQueueAdapter, $useAnalyzedFlows, $useFunctionRegistry, useStreamTopics } from '#imports'
import { getTriggerRuntime } from '../utils/triggerRuntime'
import { scheduleTrigger, unscheduleTrigger } from '../utils/scheduleTrigger'

/**
 * Create trigger event wiring
 * Listens to trigger.fired events and starts subscribed flows
 * Handles await.registered and await.resolved events
 */
export function createTriggerWiring() {
  const unsubs: Array<() => void> = []
  let wired = false

  async function start() {
    if (wired) return
    wired = true

    const logger = useNventLogger('trigger-wiring')
    const eventBus = getEventBus()
    const trigger = useTrigger()
    const store = useStoreAdapter()
    const { StoreSubjects } = useStreamTopics()
    const runtime = getTriggerRuntime(store, logger)

    // Initialize trigger runtime
    await trigger.initialize()

    logger.info('Setting up trigger event wiring')

    // ============================================================================
    // HANDLER 1: PERSISTENCE - Append all trigger events to streams
    // ============================================================================
    const handlePersistence = async (e: EventRecord) => {
      try {
        // Only process ingress events (not already persisted)
        if (e.id && e.ts) {
          return
        }

        const triggerName = (e as any).triggerName || (e.data as any)?.triggerName
        if (!triggerName) {
          return
        }

        const streamName = StoreSubjects.triggerStream(triggerName)

        // Validate event has required type field
        if (!e.type) {
          logger.error('Event missing type field', { event: e })
          return
        }

        const eventData: any = {
          type: e.type,
          triggerName,
          data: e.data,
        }

        // Append to stream - returns complete event with id and ts
        const persistedEvent = await store.stream.append(streamName, eventData)

        // Republish complete event to bus so other wirings can react
        await eventBus.publish(persistedEvent as any)

        logger.debug('Stored trigger event', {
          type: e.type,
          triggerName,
          id: persistedEvent.id,
        })
      }
      catch (err) {
        logger.error('ERROR persisting trigger event', {
          type: e.type,
          triggerName: (e as any).triggerName,
          error: (err as any)?.message,
        })
      }
    }

    // ============================================================================
    // HANDLER 2: ORCHESTRATION - Update metadata, analyze stats, trigger flows
    // ============================================================================
    const handleOrchestration = async (e: EventRecord) => {
      try {
        // Only process ingress events (not already persisted)
        if (e.id && e.ts) {
          return
        }

        const triggerName = (e as any).triggerName || (e.data as any)?.triggerName
        if (!triggerName) {
          logger.debug('Orchestration skipped - no triggerName', { type: e.type })
          return
        }

        logger.debug('Processing trigger orchestration', { type: e.type, triggerName })

        const indexKey = StoreSubjects.triggerIndex()
        const now = new Date().toISOString()
        const nowTimestamp = Date.now()

        // For trigger.registered, initialize index
        if (e.type === 'trigger.registered') {
          const data = e.data as any

          if (store.index.add) {
            await store.index.add(indexKey, triggerName, nowTimestamp, {
              'name': data.name,
              'type': data.type,
              'scope': data.scope,
              'status': 'active',
              'displayName': data.displayName,
              'description': data.description,
              'source': data.source || 'programmatic',
              'registeredAt': now,
              'registeredBy': 'runtime',
              'lastActivityAt': now,
              'stats.totalFires': 0,
              'stats.totalFlowsStarted': 0,
              'stats.activeSubscribers': 0,
              'webhook': data.webhook,
              'schedule': data.schedule,
              'config': data.config,
              'version': 1,
            })
          }

          // Add to runtime
          const entry: TriggerEntry = {
            name: data.name,
            type: data.type,
            scope: data.scope,
            status: 'active',
            displayName: data.displayName,
            description: data.description,
            source: data.source || 'programmatic',
            registeredAt: now,
            registeredBy: 'runtime',
            lastActivityAt: now,
            subscriptions: {},
            stats: { totalFires: 0, totalFlowsStarted: 0, activeSubscribers: 0 },
            webhook: data.webhook,
            schedule: data.schedule,
            config: data.config,
            version: 1,
          }
          runtime.addTrigger(triggerName, entry)

          logger.info('Registered trigger in index', { triggerName })

          // If this is a schedule trigger, create the scheduler job
          if (data.type === 'schedule' && data.schedule) {
            await scheduleTrigger(triggerName, data.schedule, data.status || 'active')
          }
        }

        // For trigger.updated, update index AND runtime
        if (e.type === 'trigger.updated') {
          const data = e.data as any

          if (store.index.updateWithRetry) {
            await store.index.updateWithRetry(indexKey, triggerName, {
              type: data.type,
              scope: data.scope,
              status: data.status,
              displayName: data.displayName,
              description: data.description,
              webhook: data.webhook,
              schedule: data.schedule,
              config: data.config,
              lastActivityAt: now,
            })
          }

          // Update runtime state with new config
          const existing = runtime.getTrigger(triggerName)
          if (existing) {
            const updated: TriggerEntry = {
              ...existing,
              status: data.status !== undefined ? data.status : existing.status,
              displayName: data.displayName !== undefined ? data.displayName : existing.displayName,
              description: data.description !== undefined ? data.description : existing.description,
              webhook: data.webhook !== undefined ? data.webhook : existing.webhook,
              schedule: data.schedule !== undefined ? data.schedule : existing.schedule,
              config: data.config !== undefined ? data.config : existing.config,
              lastActivityAt: now,
            }
            runtime.addTrigger(triggerName, updated)

            // If schedule trigger, update the scheduler job (config or status change)
            if (updated.type === 'schedule' && updated.schedule) {
              await scheduleTrigger(triggerName, updated.schedule, updated.status)
            }
          }

          logger.info('Updated trigger in index and runtime', { triggerName, status: data.status })
        }

        // For subscription.added, update trigger index
        if (e.type === 'subscription.added') {
          const data = e.data as any
          const { flow, mode } = data

          // Check if subscription already exists to prevent duplicates
          const existingSub = runtime.getSubscription(triggerName, flow)

          if (store.index.updateWithRetry) {
            await store.index.updateWithRetry(indexKey, triggerName, {
              subscriptions: {
                [flow]: {
                  mode,
                  subscribedAt: existingSub ? (existingSub.registeredAt || now) : now,
                },
              },
              lastActivityAt: now,
            })

            // Increment subscriber count only if this is a truly new subscription
            if (!existingSub && store.index.increment) {
              await store.index.increment(indexKey, triggerName, 'stats.activeSubscribers', 1)
            }
          }

          // Add/update in runtime
          const subscription: TriggerSubscription = {
            triggerName,
            flowName: flow,
            mode,
            source: 'programmatic',
            registeredAt: existingSub?.registeredAt || now,
          }
          runtime.addSubscription(triggerName, flow, subscription)

          logger.info(`Subscription ${existingSub ? 'updated' : 'added'}`, { triggerName, flow, mode })
        }

        // For subscription.removed, update trigger index
        if (e.type === 'subscription.removed') {
          const data = e.data as any
          const { flow } = data

          if (store.index.updateWithRetry) {
            await store.index.updateWithRetry(indexKey, triggerName, {
              subscriptions: {
                [flow]: null, // null removes the field
              },
              lastActivityAt: now,
            })

            // Decrement subscriber count
            if (store.index.increment) {
              await store.index.increment(indexKey, triggerName, 'stats.activeSubscribers', -1)
            }
          }

          // Remove from runtime
          runtime.removeSubscription(triggerName, flow)

          logger.info('Subscription removed', { triggerName, flow })
        }

        // For trigger.fired, orchestrate flow starts
        if (e.type === 'trigger.fired') {
          // Orchestrate flow starts (critical part!)
          const flowsStarted = await handleTriggerFired(e as unknown as TriggerFiredEvent)

          // Increment totalFlowsStarted directly here where we have the data
          if (flowsStarted.length > 0 && store.index.increment) {
            await store.index.increment(indexKey, triggerName, 'stats.totalFlowsStarted', flowsStarted.length)
          }

          logger.debug('Trigger fired and processed', { triggerName, flowsStarted: flowsStarted.length })
        }

        // For trigger.deleted, remove all data
        if (e.type === 'trigger.deleted') {
          // Check if this was a schedule trigger BEFORE removing from runtime
          const triggerEntry = runtime.getTrigger(triggerName)
          const wasScheduleTrigger = triggerEntry?.type === 'schedule'

          // Remove from index
          if (store.index.delete) {
            await store.index.delete(indexKey, triggerName)
          }

          // Remove trigger stream (contains event history)
          const triggerStreamKey = StoreSubjects.triggerStream(triggerName)
          if (store.stream.delete) {
            await store.stream.delete(triggerStreamKey)
          }

          // Remove from runtime
          runtime.removeTrigger(triggerName)

          // If this was a schedule trigger, unschedule it
          if (wasScheduleTrigger) {
            await unscheduleTrigger(triggerName)
          }

          logger.info('Trigger deleted completely', { triggerName })
        }
      }
      catch (err) {
        logger.error('ERROR in trigger orchestration', {
          type: e.type,
          triggerName: (e as any).triggerName,
          error: (err as any)?.message,
          stack: (err as any)?.stack,
        })
      }
    }

    // ============================================================================
    // HANDLER 3: TRIGGER STATS - Update trigger-level statistics from trigger events
    // ============================================================================
    const handleTriggerStats = async (e: EventRecord) => {
      try {
        // Only process persisted trigger events
        if (!e.id || !e.ts) {
          return
        }

        const triggerName = (e as any).triggerName || (e.data as any)?.triggerName
        if (!triggerName) return

        const indexKey = StoreSubjects.triggerIndex()
        const now = new Date().toISOString()

        // Update trigger index stats based on event type
        if (e.type === 'trigger.fired') {
          // Update statistics in index
          if (store.index.updateWithRetry) {
            await store.index.updateWithRetry(indexKey, triggerName, {
              stats: {
                lastFiredAt: now,
              },
              lastActivityAt: now,
            })
          }

          // Increment fire count atomically
          if (store.index.increment) {
            await store.index.increment(indexKey, triggerName, 'stats.totalFires', 1)
          }

          logger.debug('Updated trigger stats for fire', { triggerName })
        }

        // Publish stats update event to internal bus so streamWiring can send it to clients
        try {
          if (store.index.get) {
            const indexEntry = await store.index.get(indexKey, triggerName)
            if (indexEntry) {
              await eventBus.publish({
                type: 'trigger.stats.updated',
                triggerName,
                id: indexEntry.id,
                metadata: indexEntry.metadata,
                ts: Date.now(),
              } as any)
              logger.debug('Published trigger stats update event to bus', { triggerName })
            }
          }
        }
        catch (err) {
          logger.warn('Failed to publish trigger stats update event', {
            triggerName,
            error: (err as any)?.message,
          })
        }
      }
      catch (err) {
        logger.warn('Failed to update trigger stats', {
          type: e.type,
          triggerName: (e as any).triggerName,
          error: (err as any)?.message,
        })
      }
    }

    // Subscribe to all trigger event types with persistence, orchestration, and stats handlers
    // Order matters: Persistence runs first, then orchestration (creates indexes), then stats
    const eventTypes = [
      'trigger.registered',
      'trigger.updated',
      'trigger.deleted',
      'trigger.fired',
      'subscription.added',
      'subscription.removed',
    ]

    const triggerStatsEventTypes = ['trigger.fired']

    // Register persistence handler first (stores events)
    for (const type of eventTypes) {
      unsubs.push(eventBus.onType(type, handlePersistence))
    }

    // Register orchestration handler second (updates metadata, triggers flows)
    for (const type of eventTypes) {
      unsubs.push(eventBus.onType(type, handleOrchestration))
    }

    // Register trigger stats handler third (updates trigger-level stats after indexes exist)
    for (const type of triggerStatsEventTypes) {
      unsubs.push(eventBus.onType(type, handleTriggerStats))
    }

    logger.info('Trigger event wiring setup complete (persistence + orchestration + stats)')
  }

  function stop() {
    const logger = useNventLogger('trigger-wiring')

    for (const u of unsubs.splice(0)) {
      try {
        u()
      }
      catch {
        // ignore
      }
    }

    wired = false
    logger.debug('Trigger wiring stopped')
  }

  return { start, stop }
}

/**
 * Handle trigger.fired event
 * Starts all subscribed flows (auto mode) or queues them (manual mode)
 * Returns list of flows that were started for stream metadata
 */
export async function handleTriggerFired(event: TriggerFiredEvent): Promise<string[]> {
  const logger = useNventLogger('trigger-wiring')
  const trigger = useTrigger()

  const { triggerName, data } = event

  logger.debug('Trigger fired', { trigger: triggerName })

  // Get all subscribed flows
  const subscriptions = trigger.getAllSubscriptions()
    .filter(sub => sub.triggerName === triggerName)

  if (subscriptions.length === 0) {
    logger.warn(`No flows subscribed to trigger: ${triggerName}`)
    return []
  }

  const flowsStarted: string[] = []

  // Resolve payload reference if needed (converts __payloadRef to actual data)
  const store = useStoreAdapter()
  const loggerForRuntime = useNventLogger('trigger-runtime')
  const runtime = getTriggerRuntime(store, loggerForRuntime)
  const resolvedData = await runtime.resolvePayload(data)

  // Start each subscribed flow
  for (const subscription of subscriptions) {
    try {
      if (subscription.mode === 'manual') {
        // Manual mode: just log, user must start flow manually
        logger.info(
          `Trigger '${triggerName}' fired for flow '${subscription.flowName}' `
          + `(manual mode - awaiting manual start)`,
        )
        continue
      }

      // Auto mode: start flow automatically with resolved data
      await startFlowFromTrigger(subscription.flowName, triggerName, resolvedData)
      flowsStarted.push(subscription.flowName)
    }
    catch (error) {
      logger.error('Error starting flow from trigger', {
        flow: subscription.flowName,
        trigger: triggerName,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return flowsStarted
}

/**
 * Start a flow from a trigger event
 * Enqueues the entry step and publishes flow.start event
 */
export async function startFlowFromTrigger(
  flowName: string,
  triggerName: string,
  triggerData: any,
) {
  const logger = useNventLogger('trigger-wiring')
  const eventBus = getEventBus()
  const queue = useQueueAdapter()
  const registry = $useFunctionRegistry() as any
  const analyzedFlows = $useAnalyzedFlows()
  const store = useStoreAdapter()
  const triggerRuntime = getTriggerRuntime(store, logger)

  // Verify flow exists
  const flowDef = analyzedFlows.find((f: any) => f.id === flowName) as any
  if (!flowDef || !flowDef.entry) {
    logger.error(`Flow '${flowName}' not found or has no entry point`)
    return
  }

  // Get flow registry for entry step details
  const flowRegistry = (registry?.flows || {})[flowName]
  if (!flowRegistry?.entry) {
    logger.error(`Flow '${flowName}' has no entry in registry`)
    return
  }

  // Get trigger definition for type information
  const triggerDef = triggerRuntime.getTrigger(triggerName)
  const triggerType = triggerDef?.type || 'manual'

  // Generate run ID
  const runId = `${flowName}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`

  logger.info(`Starting flow '${flowName}' from trigger '${triggerName}'`, { runId })

  // Get queue name and step name from entry
  const queueName = flowRegistry.entry.queue
  const stepName = flowRegistry.entry.step

  // Build entry step payload
  const payload = {
    flowId: runId,
    flowName,
    trigger: {
      name: triggerName,
      type: triggerType,
      data: triggerData,
    },
    ...triggerData,
  }

  // Get default job options from entry worker config
  const entryWorker = (registry?.workers as any[])?.find((w: any) =>
    w?.flow?.step === stepName && w?.queue?.name === queueName,
  )
  const defaultOpts = entryWorker?.queue?.defaultJobOptions || {}

  // Get stepTimeout from analyzed flow metadata (calculated during flow analysis)
  const analyzedEntry = flowDef.analyzed?.steps?.[stepName]
  const stepTimeout = analyzedEntry?.stepTimeout

  const jobId = `${runId}__${stepName}`
  const opts = { ...defaultOpts, jobId, timeout: stepTimeout }

  try {
    // Enqueue the entry step
    await queue.enqueue(queueName, {
      name: stepName,
      data: payload,
      opts,
    })

    logger.info(`Enqueued entry step '${stepName}' to queue '${queueName}'`, { runId })

    // Publish flow.start event for tracking
    await eventBus.publish({
      type: 'flow.start',
      flowName,
      runId,
      data: {
        input: triggerData,
        trigger: {
          name: triggerName,
          type: triggerType,
          data: triggerData,
        },
      },
    } as EventRecord)
  }
  catch (error) {
    logger.error('Failed to start flow from trigger', {
      flowName,
      trigger: triggerName,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
