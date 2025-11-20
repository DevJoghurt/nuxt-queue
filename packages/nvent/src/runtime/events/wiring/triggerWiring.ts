import type { EventRecord } from '../../adapters/interfaces/store'
import type { TriggerFiredEvent } from '../types'
import type { TriggerEntry, TriggerSubscription } from '../../../registry/types'
import { getEventBus } from '../eventBus'
import { useTrigger, useNventLogger, useStoreAdapter, useQueueAdapter, $useAnalyzedFlows, $useQueueRegistry, useStreamTopics } from '#imports'
import { getTriggerRuntime } from '../utils/triggerRuntime'

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
    const { SubjectPatterns } = useStreamTopics()
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

        const streamName = SubjectPatterns.trigger(triggerName)

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
        const persistedEvent = await store.append(streamName, eventData)

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

        const indexKey = SubjectPatterns.triggerIndex()
        const now = new Date().toISOString()
        const nowTimestamp = Date.now()

        // For trigger.registered, initialize index
        if (e.type === 'trigger.registered') {
          const data = e.data as any

          if (store.indexAdd) {
            await store.indexAdd(indexKey, triggerName, nowTimestamp, {
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
            stats: { totalFires: 0, activeSubscribers: 0 },
            webhook: data.webhook,
            schedule: data.schedule,
            config: data.config,
            version: 1,
          }
          runtime.addTrigger(triggerName, entry)

          logger.info('Registered trigger in index', { triggerName })
        }

        // For trigger.updated, update index
        if (e.type === 'trigger.updated') {
          const data = e.data as any

          if (store.indexUpdateWithRetry) {
            await store.indexUpdateWithRetry(indexKey, triggerName, {
              type: data.type,
              scope: data.scope,
              displayName: data.displayName,
              description: data.description,
              webhook: data.webhook,
              schedule: data.schedule,
              config: data.config,
              lastActivityAt: now,
            })
          }

          logger.info('Updated trigger in index', { triggerName })
        }

        // For subscription.added, update trigger index
        if (e.type === 'subscription.added') {
          const data = e.data as any
          const { flow, mode, isUpdate } = data

          if (store.indexUpdateWithRetry) {
            await store.indexUpdateWithRetry(indexKey, triggerName, {
              [`subscriptions.${flow}.mode`]: mode,
              [`subscriptions.${flow}.subscribedAt`]: now,
              lastActivityAt: now,
            })

            // Increment subscriber count if this is a new subscription
            if (!isUpdate && store.indexIncrement) {
              await store.indexIncrement(indexKey, triggerName, 'stats.activeSubscribers', 1)
            }
          }

          // Add to runtime
          const subscription: TriggerSubscription = {
            triggerName,
            flowName: flow,
            mode,
            source: 'programmatic',
            registeredAt: now,
          }
          runtime.addSubscription(triggerName, flow, subscription)

          logger.info('Subscription added', { triggerName, flow, mode })
        }

        // For subscription.removed, update trigger index
        if (e.type === 'subscription.removed') {
          const data = e.data as any
          const { flow } = data

          if (store.indexUpdateWithRetry) {
            await store.indexUpdateWithRetry(indexKey, triggerName, {
              [`subscriptions.${flow}`]: null, // null removes the field
              lastActivityAt: now,
            })

            // Decrement subscriber count
            if (store.indexIncrement) {
              await store.indexIncrement(indexKey, triggerName, 'stats.activeSubscribers', -1)
            }
          }

          // Remove from runtime
          runtime.removeSubscription(triggerName, flow)

          logger.info('Subscription removed', { triggerName, flow })
        }

        // For trigger.fired, update stats and start flows
        if (e.type === 'trigger.fired') {
          // Update statistics in index
          if (store.indexUpdateWithRetry) {
            await store.indexUpdateWithRetry(indexKey, triggerName, {
              ['stats.lastFiredAt']: now,
              ['lastActivityAt']: now,
            })
          }

          // Increment fire count atomically
          if (store.indexIncrement) {
            await store.indexIncrement(indexKey, triggerName, 'stats.totalFires', 1)
          }

          // Orchestrate flow starts (this is the critical part!)
          const flowsStarted = await handleTriggerFired(e as unknown as TriggerFiredEvent)

          logger.debug('Trigger fired and processed', { triggerName, flowsStarted: flowsStarted.length })
        }

        // For trigger.retired, update status
        if (e.type === 'trigger.retired') {
          const data = e.data as any

          // Get final stats from index
          let finalStats = { totalFires: 0, activeSubscribers: 0 }
          if (store.indexGet) {
            const entry = await store.indexGet(indexKey, triggerName)
            if (entry?.metadata) {
              finalStats = (entry.metadata as any).stats || finalStats
            }
          }

          if (store.indexUpdateWithRetry) {
            await store.indexUpdateWithRetry(indexKey, triggerName, {
              status: 'retired',
              retiredAt: now,
              retiredReason: data.reason,
              lastActivityAt: now,
              finalStats,
            })
          }

          // Remove from runtime
          runtime.removeTrigger(triggerName)

          logger.info('Trigger retired', { triggerName, reason: data.reason })
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

    // Subscribe to all trigger event types with BOTH handlers
    // Order matters: Persistence runs first, then orchestration
    const eventTypes = [
      'trigger.registered',
      'trigger.updated',
      'trigger.retired',
      'trigger.fired',
      'subscription.added',
      'subscription.removed',
    ]

    // Register persistence handler first (stores events)
    for (const type of eventTypes) {
      unsubs.push(eventBus.onType(type, handlePersistence))
    }

    // Register orchestration handler second (updates metadata, triggers flows)
    for (const type of eventTypes) {
      unsubs.push(eventBus.onType(type, handleOrchestration))
    }

    logger.info('Trigger event wiring setup complete')
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
  const registry = $useQueueRegistry() as any
  const analyzedFlows = $useAnalyzedFlows()

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
      data: triggerData,
    },
    ...triggerData,
  }

  // Get default job options from entry worker config
  const entryWorker = (registry?.workers as any[])?.find((w: any) =>
    w?.flow?.step === stepName && w?.queue?.name === queueName,
  )
  const defaultOpts = entryWorker?.queue?.defaultJobOptions || {}
  const jobId = `${runId}__${stepName}`
  const opts = { ...defaultOpts, jobId }

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
