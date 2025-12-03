# Trigger System Implementation Plan

> **Version**: v0.5.0  
> **Date**: 2025-11-19  
> **Status**: Implementation Plan

## Architecture Overview

Following the existing nvent structure:
- **Registry/Utils** - Developer/build-time (type definitions, analyzers)
- **Runtime** - Runtime implementations (adapters, wiring, composables)
- **Runtime/Utils** - API functions wrapped in composables (useTrigger)
- **Runtime/Events/Wiring** - Event-based wiring implementation

## File Structure

```
packages/nvent/src/
├── registry/
│   ├── types.ts                    # Add TriggerEntry, TriggerConfig types
│   └── triggerAnalyzer.ts         # NEW: Analyze trigger configs from workers
├── runtime/
│   ├── events/
│   │   ├── types.ts                # Add trigger event types
│   │   └── wiring/
│   │       └── triggerWiring.ts   # NEW: Trigger event wiring
│   └── utils/
│       └── useTrigger.ts          # NEW: Core trigger composable
└── utils/
    └── defineFunctionConfig.ts     # Add trigger config types
```

## Implementation Phases

### Phase 1: Type Definitions & Registry (Build-Time)

#### 1.1. Update `runtime/utils/defineFunctionConfig.ts`

Add trigger configuration types for AST parsing:

```typescript
// Add to existing FlowConfig interface
export interface FlowConfig {
  // ... existing fields ...
  
  /**
   * Entry trigger configuration (flow-scoped)
   * Subscribe to existing triggers to start flow runs
   */
  triggers?: {
    /**
     * Array of trigger names to subscribe to
     */
    subscribe: string[]
    /**
     * Trigger mode: 'auto' (immediate) or 'manual' (requires approval)
     */
    mode?: 'auto' | 'manual'
  }
  
  /**
   * Await pattern: Wait BEFORE step execution
   * Step won't execute until trigger fires
   */
  awaitBefore?: AwaitConfig
  
  /**
   * Await pattern: Wait AFTER step execution  
   * Next steps won't trigger until trigger fires
   */
  awaitAfter?: AwaitConfig
}

/**
 * Await configuration (run-scoped triggers)
 * Declared in config, no functions allowed (AST-parsed)
 */
export interface AwaitConfig {
  /**
   * Trigger type
   */
  type: 'webhook' | 'event' | 'schedule' | 'time'
  
  // Webhook-specific
  path?: string  // Supports {runId}, {stepId} template variables
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  
  // Event-specific
  event?: string  // Event name to wait for
  filterKey?: string  // Match key: 'orderId' matches event.orderId === step.orderId
  
  // Schedule-specific
  cron?: string  // Cron expression
  nextAfterHours?: number  // Hours offset after completion
  timezone?: string
  
  // Time-specific
  delay?: number  // Milliseconds
  
  // Common options
  timeout?: number  // Timeout in ms
  timeoutAction?: 'fail' | 'continue' | 'retry'
}
```

#### 1.2. Update `registry/types.ts`

Add trigger metadata to WorkerEntry:

```typescript
export type WorkerEntry = {
  // ... existing fields ...
  
  flow?: {
    // ... existing flow fields ...
    
    // Entry triggers (flow-scoped)
    triggers?: {
      subscribe: string[]
      mode?: 'auto' | 'manual'
    }
    
    // Await patterns (run-scoped)
    awaitBefore?: AwaitConfig
    awaitAfter?: AwaitConfig
  }
}

/**
 * Trigger definition (registered programmatically)
 */
export type TriggerEntry = {
  name: string
  type: 'event' | 'webhook' | 'schedule' | 'manual'
  scope: 'flow' | 'run'
  displayName?: string
  description?: string
  source?: string
  
  // Optional validation hints (not enforced)
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
  
  // Metadata
  registeredAt: string
  registeredBy: 'code' | 'runtime'
}

/**
 * Trigger subscription (runtime index)
 */
export type TriggerSubscription = {
  triggerName: string
  flowName: string
  mode: 'auto' | 'manual'
  source: 'config' | 'programmatic'
  registeredAt: string
}
```

#### 1.3. Create `registry/triggerAnalyzer.ts`

Analyze trigger configs from worker files (build-time):

```typescript
import type { WorkerEntry, TriggerSubscription } from './types'

/**
 * Analyze workers to extract trigger subscriptions
 * Called during build to create trigger subscription index
 */
export function analyzeTriggerSubscriptions(
  workers: WorkerEntry[]
): TriggerSubscription[] {
  const subscriptions: TriggerSubscription[] = []
  
  for (const worker of workers) {
    if (!worker.flow?.triggers?.subscribe) continue
    
    const flowName = Array.isArray(worker.flow.names)
      ? worker.flow.names[0]
      : worker.flow.names
    
    for (const triggerName of worker.flow.triggers.subscribe) {
      subscriptions.push({
        triggerName,
        flowName,
        mode: worker.flow.triggers.mode || 'auto',
        source: 'config',
        registeredAt: new Date().toISOString()
      })
    }
  }
  
  return subscriptions
}

/**
 * Build bidirectional trigger index
 */
export function buildTriggerIndex(
  subscriptions: TriggerSubscription[]
): {
  triggerToFlows: Map<string, Set<string>>
  flowToTriggers: Map<string, Set<string>>
} {
  const triggerToFlows = new Map<string, Set<string>>()
  const flowToTriggers = new Map<string, Set<string>>()
  
  for (const sub of subscriptions) {
    // Trigger -> Flows
    if (!triggerToFlows.has(sub.triggerName)) {
      triggerToFlows.set(sub.triggerName, new Set())
    }
    triggerToFlows.get(sub.triggerName)!.add(sub.flowName)
    
    // Flow -> Triggers
    if (!flowToTriggers.has(sub.flowName)) {
      flowToTriggers.set(sub.flowName, new Set())
    }
    flowToTriggers.get(sub.flowName)!.add(sub.triggerName)
  }
  
  return { triggerToFlows, flowToTriggers }
}
```

### Phase 2: Runtime State & Composable

#### 2.1. Create `runtime/utils/useTrigger.ts`

Core trigger composable (runtime API):

```typescript
import type { TriggerEntry, TriggerSubscription } from '../../registry/types'
import { useStoreAdapter, useNventLogger } from '#imports'

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
      initialized: false
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
  schema?: any  // Zod schema
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
    registerTrigger(opts: RegisterTriggerOptions) {
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
        registeredAt: new Date().toISOString(),
        registeredBy: 'runtime'
      }
      
      runtime.triggers.set(opts.name, entry)
      
      // Persist to store using centralized collection name
      const { SubjectPatterns } = await import('./useStreamTopics')
      store.save(SubjectPatterns.triggers(), opts.name, {
        ...entry,
        schema: opts.schema?.toString(),  // Serialize schema
        transform: opts.transform?.toString(),  // Serialize transform
        config: opts.config
      })
      
      logger.info(`Registered trigger: ${opts.name} (${opts.type}, ${opts.scope})`)
      
      // Validate expected subscribers
      if (opts.expectedSubscribers) {
        const actual = runtime.triggerToFlows.get(opts.name)
        for (const expected of opts.expectedSubscribers) {
          const found = Array.from(actual || []).some(
            sub => sub.flowName === expected
          )
          if (!found) {
            logger.warn(
              `Trigger '${opts.name}' expects subscriber '${expected}' ` +
              `but it's not registered`
            )
          }
        }
      }
    },
    
    /**
     * Subscribe flow to trigger (programmatic)
     */
    subscribeTrigger(opts: SubscribeTriggerOptions) {
      const { trigger, flow, mode = 'auto', filter, transform } = opts
      
      const subscription: TriggerSubscription = {
        triggerName: trigger,
        flowName: flow,
        mode,
        source: 'programmatic',
        registeredAt: new Date().toISOString()
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
      const { SubjectPatterns } = await import('./useStreamTopics')
      store.save(SubjectPatterns.triggerSubscriptions(), `${trigger}:${flow}`, {
        trigger,
        flow,
        mode,
        filter: filter?.toString(),
        transform: transform?.toString(),
        source: 'programmatic',
        registeredAt: new Date().toISOString()
      })
      
      logger.info(`Subscribed flow '${flow}' to trigger '${trigger}' (${mode})`)
    },
    
    /**
     * Unsubscribe flow from trigger
     */
    unsubscribeTrigger(trigger: string, flow: string) {
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
      const { SubjectPatterns } = await import('./useStreamTopics')
      store.delete(SubjectPatterns.triggerSubscriptions(), `${trigger}:${flow}`)
      
      logger.info(`Unsubscribed flow '${flow}' from trigger '${trigger}'`)
    },
    
    /**
     * Emit trigger (fire event)
     * This is handled by triggerWiring.ts
     */
    async emitTrigger(name: string, data: any) {
      // Use centralized topic patterns
      const { SubjectPatterns } = await import('./useStreamTopics')
      const streamName = SubjectPatterns.triggerFired(name)
      
      await store.append(streamName, {
        type: 'trigger.fired',
        triggerName: name,
        data
      } as any)
      
      logger.debug(`Emitted trigger: ${name}`)
    },
    
    /**
     * Query methods
     */
    getTrigger(name: string): TriggerEntry | undefined {
      return runtime.triggers.get(name)
    },
    
    getAllTriggers(): TriggerEntry[] {
      return Array.from(runtime.triggers.values())
    },
    
    getSubscribedFlows(trigger: string): string[] {
      const subs = runtime.triggerToFlows.get(trigger) || new Set()
      return Array.from(subs).map(s => s.flowName)
    },
    
    getFlowTriggers(flow: string): string[] {
      return Array.from(runtime.flowToTriggers.get(flow) || new Set())
    },
    
    /**
     * Initialize runtime from store (called on startup)
     */
    async initialize() {
      if (runtime.initialized) return
      
      logger.info('Initializing trigger runtime...')
      
      // Load triggers from store using centralized collection names
      const { SubjectPatterns } = await import('./useStreamTopics')
      if (store.list) {
        const triggers = await store.list(SubjectPatterns.triggers())
        for (const { id, doc } of triggers) {
          runtime.triggers.set(id, doc as TriggerEntry)
        }
        
        // Load subscriptions from store
        const subscriptions = await store.list(SubjectPatterns.triggerSubscriptions())
        for (const { id, doc } of subscriptions) {
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
          `Loaded ${triggers.length} triggers and ` +
          `${subscriptions.length} subscriptions from store`
        )
      }
      
      runtime.initialized = true
    }
  }
}
```

### Phase 3: Event Wiring Implementation

#### 3.0. Update `runtime/utils/useStreamTopics.ts` ✅ DONE

Added trigger-related subject patterns and topic functions:
- `SubjectPatterns.triggerRegistry()` - Trigger registry stream
- `SubjectPatterns.triggerFired(name)` - Trigger event stream
- `SubjectPatterns.triggers()` - Triggers collection
- `SubjectPatterns.triggerSubscriptions()` - Subscriptions collection
- `SubjectPatterns.awaitTrigger(runId, step)` - Await event stream
- `SubjectPatterns.awaitRegistry(runId)` - Await registry
- `SubjectPatterns.awaitStatus(runId, step)` - KV status key
- `SubjectPatterns.webhookRoute(path)` - Webhook routing
- `getTriggerEventTopic(name)` - Stream topic for trigger events
- `getAwaitEventTopic(runId, step)` - Stream topic for await events

#### 3.1. Update `runtime/events/types.ts`

Add trigger event types:

```typescript
// Add to existing EventType union
export type EventType = 
  | 'flow.start' 
  | 'flow.completed' 
  // ... existing types ...
  | 'trigger.fired'           // NEW: Trigger event fired
  | 'trigger.registered'      // NEW: Trigger registered
  | 'await.registered'        // NEW: Await trigger created
  | 'await.resolved'          // NEW: Await trigger resolved
  | 'await.timeout'           // NEW: Await trigger timed out

// Add new event interfaces
export interface TriggerFiredEvent extends BaseEvent {
  type: 'trigger.fired'
  triggerName: string
  data: any
}

export interface AwaitRegisteredEvent extends BaseEvent {
  type: 'await.registered'
  stepName: string
  awaitType: 'webhook' | 'event' | 'schedule' | 'time'
  position: 'before' | 'after'
  config: any
}

export interface AwaitResolvedEvent extends BaseEvent {
  type: 'await.resolved'
  stepName: string
  triggerData: any
}

export interface AwaitTimeoutEvent extends BaseEvent {
  type: 'await.timeout'
  stepName: string
  action: 'fail' | 'continue' | 'retry'
}
```

#### 3.2. Create `runtime/events/wiring/triggerWiring.ts`

Trigger event wiring (similar to flowWiring.ts):

```typescript
import type { EventRecord } from '../../adapters/interfaces/store'
import { getEventBus } from '../eventBus'
import { 
  useNventLogger, 
  useStoreAdapter, 
  useQueueAdapter,
  $useAnalyzedFlows,
  $useQueueRegistry 
} from '#imports'

// Note: All stream topics are centralized in useStreamTopics()
// Import topics from there instead of defining locally:
// const { SubjectPatterns, getTriggerEventTopic, getAwaitEventTopic } = useStreamTopics()

/**
 * Setup trigger wiring
 * Listens to trigger.fired events and routes to subscribed flows
 */
export async function setupTriggerWiring() {
  const logger = useNventLogger('trigger-wiring')
  const store = useStoreAdapter()
  const bus = getEventBus()
  
  logger.info('Setting up trigger wiring...')
  
  // Subscribe to trigger registry stream
  if (!store.subscribe) {
    logger.warn('Store adapter does not support subscriptions')
    return
  }
  
  // Listen to all trigger events
  await store.subscribe('nq:trigger:*', async (event: EventRecord) => {
    if (event.type === 'trigger.fired') {
      await handleTriggerFired(event as any)
    }
  })
  
  logger.info('Trigger wiring active')
}

/**
 * Handle trigger.fired event
 * Routes to all subscribed flows
 */
async function handleTriggerFired(event: any) {
  const logger = useNventLogger('trigger-wiring')
  const { triggerName, data } = event
  
  logger.debug(`Trigger fired: ${triggerName}`)
  
  // Get trigger runtime
  const { useTrigger } = await import('../../utils/useTrigger')
  const trigger = useTrigger()
  await trigger.initialize()
  
  // Get subscribed flows
  const flows = trigger.getSubscribedFlows(triggerName)
  
  if (flows.length === 0) {
    logger.warn(`Trigger '${triggerName}' has no subscribers`)
    return
  }
  
  logger.info(
    `Trigger '${triggerName}' firing for ${flows.length} flow(s): ` +
    flows.join(', ')
  )
  
  // Start each subscribed flow
  for (const flowName of flows) {
    try {
      await startFlowFromTrigger(flowName, triggerName, data)
    } catch (error) {
      logger.error(
        `Failed to start flow '${flowName}' from trigger '${triggerName}':`,
        error
      )
    }
  }
}

/**
 * Start flow from trigger
 */
async function startFlowFromTrigger(
  flowName: string,
  triggerName: string,
  data: any
) {
  const logger = useNventLogger('trigger-wiring')
  const store = useStoreAdapter()
  const queue = useQueueAdapter()
  const registry = $useQueueRegistry() as any
  const { SubjectPatterns } = await import('../utils/streamTopics')
  
  // Get flow definition from registry
  const flowRegistry = (registry?.flows || {})[flowName]
  if (!flowRegistry?.entry) {
    logger.warn(`Flow '${flowName}' has no entry point`)
    return
  }
  
  // Generate run ID
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
  
  logger.info(`Starting flow '${flowName}' with runId: ${runId}`)
  
  // Create flow run stream
  const streamName = SubjectPatterns.flowRun(runId)
  
  // Append flow.start event
  await store.append(streamName, {
    type: 'flow.start',
    runId,
    flowName,
    data: {
      input: data,
      trigger: triggerName,  // Track which trigger started this flow
      triggeredAt: new Date().toISOString()
    }
  } as any)
  
  // Index flow run for queries
  const indexKey = SubjectPatterns.flowRunIndex(flowName)
  if (store.indexAdd) {
    await store.indexAdd(indexKey, runId, {
      runId,
      flowName,
      status: 'running',
      startedAt: new Date().toISOString(),
      trigger: triggerName,
      metadata: {
        emittedEvents: []
      }
    })
  }
  
  // Enqueue entry step
  const entryQueue = flowRegistry.entry.queue
  await queue.add(entryQueue, runId, {
    input: data,
    flowId: runId,
    flowName,
    trigger: triggerName
  })
  
  logger.info(
    `Flow '${flowName}' started via trigger '${triggerName}', ` +
    `enqueued to '${entryQueue}'`
  )
}

/**
 * Setup await wiring
 * Handles awaitBefore and awaitAfter patterns
 */
export async function setupAwaitWiring() {
  const logger = useNventLogger('await-wiring')
  const store = useStoreAdapter()
  
  logger.info('Setting up await wiring...')
  
  if (!store.subscribe) {
    logger.warn('Store adapter does not support subscriptions')
    return
  }
  
  // Listen to await events
  await store.subscribe('nq:await:*', async (event: EventRecord) => {
    if (event.type === 'await.registered') {
      await handleAwaitRegistered(event as any)
    } else if (event.type === 'await.resolved') {
      await handleAwaitResolved(event as any)
    }
  })
  
  logger.info('Await wiring active')
}

/**
 * Handle await.registered event
 * Sets up ephemeral trigger and calls lifecycle hook
 */
async function handleAwaitRegistered(event: any) {
  const logger = useNventLogger('await-wiring')
  const { runId, stepName, awaitType, position, config } = event
  
  logger.info(
    `Await registered: ${runId}/${stepName} (${awaitType}, ${position})`
  )
  
  // Create ephemeral trigger
  // Implementation depends on awaitType (webhook, event, schedule, time)
  // This is where we'd register webhook routes, schedule timers, etc.
  
  // Call lifecycle hook if defined
  await callLifecycleHook(runId, stepName, 'onAwaitRegister', config)
}

/**
 * Handle await.resolved event
 * Continues flow execution (before) or triggers next steps (after)
 */
async function handleAwaitResolved(event: any) {
  const logger = useNventLogger('await-wiring')
  const { runId, stepName, triggerData, position } = event
  
  logger.info(`Await resolved: ${runId}/${stepName}`)
  
  if (position === 'before') {
    // Enqueue the step now with trigger data
    await enqueueStepWithTriggerData(runId, stepName, triggerData)
  } else {
    // position === 'after'
    // Trigger subscribed steps
    await triggerSubscribedSteps(runId, stepName)
  }
  
  // Call lifecycle hook
  await callLifecycleHook(runId, stepName, 'onAwaitResolve', triggerData)
}

/**
 * Call lifecycle hook
 */
async function callLifecycleHook(
  runId: string,
  stepName: string,
  hookName: string,
  data: any
) {
  // TODO: Load worker module and call exported hook
  // This requires accessing the worker file and calling the exported function
}

/**
 * Enqueue step with trigger data (awaitBefore resolved)
 */
async function enqueueStepWithTriggerData(
  runId: string,
  stepName: string,
  triggerData: any
) {
  // TODO: Enqueue step job with trigger data in context
}

/**
 * Trigger subscribed steps (awaitAfter resolved)
 */
async function triggerSubscribedSteps(runId: string, stepName: string) {
  // TODO: Find and trigger steps that subscribe to this step's emits
}
```

### Phase 4: Integration & Storage

#### 4.1. Storage Strategy

Use existing adapter interfaces - **no new adapter methods required**.
All topics centralized in `useStreamTopics()`:

```typescript
const { SubjectPatterns } = useStreamTopics()

// Entry triggers (flow-scoped) - Persistent
store.save(SubjectPatterns.triggers(), triggerName, triggerData)
store.save(SubjectPatterns.triggerSubscriptions(), `${trigger}:${flow}`, subscriptionData)

// Trigger events - Event stream
store.append(SubjectPatterns.triggerFired(triggerName), {
  type: 'trigger.fired',
  data: eventData
})

// Await triggers (run-scoped) - Ephemeral, flow-run scoped
store.append(SubjectPatterns.awaitTrigger(runId, stepName), {
  type: 'await.registered',
  config: awaitConfig
})

// Use KV for fast lookups
store.kv.set(SubjectPatterns.awaitStatus(runId, stepName), 'waiting', ttl)
store.kv.set(SubjectPatterns.webhookRoute(path), triggerId, ttl)
```

**Data Minimization**:
- ✅ Reuse flow run streams (no separate trigger streams needed)
- ✅ Store subscriptions once (bidirectional index in memory)
- ✅ Ephemeral awaits auto-expire with flow run
- ✅ Use KV cache for hot paths

#### 4.2. Integration Points

**Auto-Discovery Plugin**:
```typescript
// runtime/server/plugins/triggerAutoDiscovery.ts
export default defineNitroPlugin(async (nitro) => {
  const { useTrigger } = await import('#nuxt-queue/trigger')
  const trigger = useTrigger()
  
  // Initialize from store
  await trigger.initialize()
  
  // Load file-based subscriptions from registry
  const registry = useRegistry()
  const subscriptions = analyzeTriggerSubscriptions(registry.workers)
  
  for (const sub of subscriptions) {
    trigger.subscribeTrigger({
      trigger: sub.triggerName,
      flow: sub.flowName,
      mode: sub.mode
    })
  }
  
  // Setup event wiring
  await setupTriggerWiring()
  await setupAwaitWiring()
})
```

## Implementation Checklist

### Phase 1: Types & Registry ✅
- [ ] Update `defineFunctionConfig.ts` with trigger types
- [ ] Update `registry/types.ts` with trigger metadata
- [ ] Create `registry/triggerAnalyzer.ts` for build-time analysis
- [ ] Add trigger config to worker scanning logic

### Phase 2: Runtime Core ✅
- [ ] Create `runtime/utils/useTrigger.ts` composable
- [ ] Implement registerTrigger
- [ ] Implement subscribeTrigger / unsubscribeTrigger
- [ ] Implement emitTrigger
- [ ] Implement query methods
- [ ] Add store persistence

### Phase 3: Event Wiring ✅
- [ ] Update `runtime/events/types.ts` with trigger events
- [ ] Create `runtime/events/wiring/triggerWiring.ts`
- [ ] Implement trigger.fired event handling
- [ ] Implement flow routing from triggers
- [ ] Implement await.registered event handling
- [ ] Implement await.resolved event handling

### Phase 4: Integration ✅
- [ ] Create auto-discovery plugin
- [ ] Add trigger initialization to startup
- [ ] Integrate with existing flow system
- [ ] Add validation and error handling
- [ ] Add logging throughout

### Phase 5: Await Patterns 🔄
- [ ] Implement webhook await (routes, handler)
- [ ] Implement event await (event matching)
- [ ] Implement schedule await (cron scheduler)
- [ ] Implement time await (delayed trigger)
- [ ] Implement timeout handling
- [ ] Call lifecycle hooks (onAwaitRegister, etc.)

### Phase 6: Testing & Docs 🔄
- [ ] Unit tests for trigger composable
- [ ] Integration tests for wiring
- [ ] E2E tests for flow triggers
- [ ] Update documentation
- [ ] Add examples

## Key Design Principles

✅ **Strict Abstractions**: Use only existing adapter interfaces  
✅ **Minimal Storage**: Reuse flow streams, minimize new collections  
✅ **Clear Separation**: Registry (build) vs Runtime vs Wiring (events)  
✅ **Composable Pattern**: useTrigger() wraps all functionality  
✅ **Event-Driven**: Wiring layer handles routing via events  
✅ **Type-Safe**: Full TypeScript from config to runtime  

## Next Steps

1. Start with Phase 1 (types & registry) - foundation
2. Implement Phase 2 (runtime core) - basic functionality
3. Add Phase 3 (event wiring) - integration with flow system
4. Complete Phase 4 (integration) - connect everything
5. Build Phase 5 (await patterns) - advanced features
6. Finish Phase 6 (testing) - quality assurance
