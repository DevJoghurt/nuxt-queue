# Trigger Index + Stream Architecture

**Version:** 0.5.1  
**Date:** November 20, 2025  
**Status:** Implementation Plan

## Overview

Migrate trigger system from document-based storage to index + stream pattern, matching the flow system architecture. This provides better lifecycle management, audit trails, and query performance.

## Current Problems

1. **Storage inefficiency**: Triggers stored as JSON docs in `.data/store/docs/triggers/`
2. **No audit trail**: No history of trigger lifecycle events or firing events
3. **Poor querying**: Must scan all documents to list/filter triggers
4. **Mixed concerns**: Permanent (developer-defined) and temporary (await-based) triggers stored together
5. **No lifecycle**: No clear active/retired state management
6. **Subscription management**: Subscriptions stored separately without trigger context

## Architecture Decision

### What Goes in Trigger System

**✅ INCLUDE:**
- Developer-defined triggers from `defineFunctionConfig`
- Manual triggers
- Webhook triggers
- Schedule triggers
- Any trigger that can be subscribed to by multiple flows

**❌ EXCLUDE:**
- Await-based patterns (`await.time`, `await.event`, `await.webhook`)
- These are flow-internal, already tracked in flow streams
- Visible through flow index `awaitingSteps` metadata

### Rationale

Await patterns are ephemeral and tied to specific flow runs. They don't need trigger-level tracking:
- Already visible in flow run streams
- Already tracked in flow run index metadata
- Short-lived by nature
- Not subscribed to by other flows

## Data Structures

### 1. Trigger Index

**Index Key:** `nq_triggers`  
**Entry ID:** `{triggerName}` (e.g., `manual.notification-test`)

```typescript
interface TriggerIndexEntry {
  id: string                    // Trigger name
  score: number                 // registeredAt timestamp (for sorting)
  metadata: {
    // Identity
    name: string
    type: 'manual' | 'event' | 'webhook' | 'schedule'
    scope: 'flow' | 'run'
    
    // Display
    displayName?: string
    description?: string
    
    // Status & Lifecycle
    status: 'active' | 'retired' | 'deprecated'
    source: string              // e.g., 'function:notifications', 'build-time'
    registeredAt: number        // timestamp
    lastActivityAt: number      // timestamp of last fire or subscription change
    retiredAt?: number          // timestamp when retired
    retiredReason?: string      // Why it was retired
    
    // Subscriptions (embedded for fast lookup)
    subscriptions: {
      [flowName: string]: {
        mode: 'auto' | 'manual'
        subscribedAt: number
      }
    }
    
    // Statistics
    stats: {
      totalFires: number        // Total times triggered
      lastFiredAt?: number      // Last fire timestamp
      activeSubscribers: number // Current subscriber count
    }
    
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
    
    // Configuration
    config?: {
      persistData?: boolean
      retentionDays?: number
      rateLimit?: {
        max: number
        window: number
      }
    }
    
    // Versioning for optimistic locking
    version: number
  }
}
```

### 2. Trigger Event Stream

**Stream Subject:** `nq_trigger:{triggerName}` (e.g., `nq_trigger:manual.notification-test`)

```typescript
// Event types in trigger stream
type TriggerEvent = 
  | TriggerRegisteredEvent
  | TriggerFiredEvent
  | SubscriptionAddedEvent
  | SubscriptionRemovedEvent
  | TriggerUpdatedEvent
  | TriggerRetiredEvent

interface TriggerRegisteredEvent {
  type: 'trigger.registered'
  id: string                    // Auto-generated
  ts: number                    // Auto-generated
  triggerName: string
  data: {
    type: string
    scope: string
    displayName?: string
    description?: string
    source: string
    config?: any
  }
}

interface TriggerFiredEvent {
  type: 'trigger.fired'
  id: string
  ts: number
  triggerName: string
  data: any                     // Trigger payload
  metadata?: {
    subscribersNotified: number
    flowsStarted: string[]
  }
}

interface SubscriptionAddedEvent {
  type: 'subscription.added'
  id: string
  ts: number
  triggerName: string
  data: {
    flowName: string
    mode: 'auto' | 'manual'
  }
}

interface SubscriptionRemovedEvent {
  type: 'subscription.removed'
  id: string
  ts: number
  triggerName: string
  data: {
    flowName: string
    reason?: string
  }
}

interface TriggerUpdatedEvent {
  type: 'trigger.updated'
  id: string
  ts: number
  triggerName: string
  data: {
    changes: Record<string, any>
  }
}

interface TriggerRetiredEvent {
  type: 'trigger.retired'
  id: string
  ts: number
  triggerName: string
  data: {
    reason: string
    finalStats: {
      totalFires: number
      totalSubscribers: number
      activeFor: number         // milliseconds
    }
  }
}
```

## Updated SubjectPatterns

```typescript
const SubjectPatterns = {
  // Existing patterns...
  flowRun: (runId: string) => `nq:flow:${runId}`,
  flowRunIndex: (flowName: string) => `nq_flows:${flowName}`,
  
  // NEW: Trigger patterns (replacing old doc-based patterns)
  trigger: (name: string) => `nq_trigger:${name}`,
  triggerIndex: () => `nq_triggers`,
  
  // REMOVE: Old document collection patterns
  // triggers: () => `triggers`,
  // triggerSubscriptions: () => `trigger-subscriptions`,
  
  // Keep: Await patterns (flow-internal, not triggers)
  awaitTrigger: (runId: string, stepName: string) => `nq:await:${runId}:${stepName}`,
  awaitRegistry: (runId: string) => `nq:await:${runId}`,
  awaitStatus: (runId: string, stepName: string) => `await:${runId}:${stepName}:status`,
}
```

## Implementation Changes

### 1. useTrigger Composable

**Key Changes:**

```typescript
// BEFORE: Using doc store
await store.save(SubjectPatterns.triggers(), opts.name, {...})
await store.save(SubjectPatterns.triggerSubscriptions(), `${trigger}:${flow}`, {...})

// AFTER: Using index + stream
const { SubjectPatterns } = useStreamTopics()
const store = useStoreAdapter()

// Register trigger -> index + stream
async registerTrigger(opts: RegisterTriggerOptions) {
  const triggerName = opts.name
  const indexKey = SubjectPatterns.triggerIndex()
  const streamName = SubjectPatterns.trigger(triggerName)
  
  // Add to index with initial metadata
  await store.indexAdd(indexKey, triggerName, Date.now(), {
    name: triggerName,
    type: opts.type,
    scope: opts.scope,
    status: 'active',
    displayName: opts.displayName,
    description: opts.description,
    source: opts.source || 'programmatic',
    registeredAt: Date.now(),
    lastActivityAt: Date.now(),
    subscriptions: {},
    stats: {
      totalFires: 0,
      activeSubscribers: 0,
    },
    webhook: opts.webhook,
    schedule: opts.schedule,
    config: opts.config,
    version: 1,
  })
  
  // Append to trigger stream
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

// Subscribe flow -> update index + stream
async subscribeTrigger(opts: SubscribeTriggerOptions) {
  const { trigger, flow, mode = 'auto' } = opts
  const indexKey = SubjectPatterns.triggerIndex()
  const streamName = SubjectPatterns.trigger(trigger)
  
  // Update index with new subscription
  await store.indexUpdateWithRetry(indexKey, trigger, {
    [`subscriptions.${flow}`]: {
      mode,
      subscribedAt: Date.now(),
    },
    lastActivityAt: Date.now(),
    version: (metadata) => metadata.version + 1,
  })
  
  // Increment subscriber count
  await store.indexIncrement(indexKey, trigger, 'stats.activeSubscribers', 1)
  
  // Append to trigger stream
  await store.append(streamName, {
    type: 'subscription.added',
    triggerName: trigger,
    data: {
      flowName: flow,
      mode,
    },
  })
}

// Fire trigger -> update stats + append to stream
async emitTrigger(name: string, data: any) {
  const indexKey = SubjectPatterns.triggerIndex()
  const streamName = SubjectPatterns.trigger(name)
  const eventBus = getEventBus()
  
  // Update last fired stats
  await store.indexUpdateWithRetry(indexKey, name, {
    'stats.lastFiredAt': Date.now(),
    lastActivityAt: Date.now(),
  })
  
  // Increment fire count
  await store.indexIncrement(indexKey, name, 'stats.totalFires', 1)
  
  // Append to trigger stream (summary only)
  await store.append(streamName, {
    type: 'trigger.fired',
    triggerName: name,
    data: {
      timestamp: Date.now(),
      // Don't store full payload in trigger stream, it goes to flow streams
    },
  })
  
  // Publish to event bus (includes full data for flow starts)
  await eventBus.publish({
    type: 'trigger.fired',
    triggerName: name,
    data,
  })
}
```

### 2. triggerWiring Updates

**Key Changes:**

```typescript
// BEFORE: Loading from doc store
const triggers = await store.list(SubjectPatterns.triggers())
const subscriptions = await store.list(SubjectPatterns.triggerSubscriptions())

// AFTER: Loading from index
const indexKey = SubjectPatterns.triggerIndex()
const entries = await store.indexRead(indexKey, { limit: 1000 })

for (const entry of entries) {
  if (entry.metadata.status === 'active') {
    runtime.triggers.set(entry.id, {
      name: entry.metadata.name,
      type: entry.metadata.type,
      // ... other fields
    })
    
    // Load subscriptions from embedded metadata
    for (const [flowName, subData] of Object.entries(entry.metadata.subscriptions)) {
      // Add to runtime maps
    }
  }
}
```

**Event Handler Updates:**

```typescript
// Listen to trigger.registered events -> update index + stream
unsubs.push(eventBus.onType('trigger.registered', async (event: EventRecord) => {
  try {
    const triggerData = event.data as any
    // Call useTrigger().registerTrigger() which now handles index + stream
    await trigger.registerTrigger({
      name: triggerData.name,
      type: triggerData.type,
      // ... all fields
    })
  } catch (error) {
    logger.error('Failed to register trigger', { error })
  }
}))

// Listen to trigger.fired events -> update stats + append
unsubs.push(eventBus.onType('trigger.fired', async (event: EventRecord) => {
  try {
    const { triggerName, data } = event
    
    // Update trigger index stats (already done in emitTrigger)
    // But add metadata about which flows started
    const flowsStarted = await handleTriggerFired(event as TriggerFiredEvent)
    
    // Optionally update stream with results
    const streamName = SubjectPatterns.trigger(triggerName)
    await store.append(streamName, {
      type: 'trigger.fired',
      triggerName,
      data: {
        flowsStarted,
        subscribersNotified: flowsStarted.length,
      },
    })
  } catch (error) {
    logger.error('Error handling trigger.fired event', { error })
  }
}))
```

### 3. Trigger Cleanup Utilities

Create `/packages/nvent/src/runtime/events/utils/triggerCleanup.ts`:

```typescript
export interface TriggerCleanupOptions {
  // Retire triggers with no subscribers after N days
  retireAfterDays?: number
  
  // Delete retired trigger streams after N days
  deleteStreamsAfterDays?: number
  
  // Dry run mode
  dryRun?: boolean
}

export async function cleanupTriggers(opts: TriggerCleanupOptions = {}) {
  const {
    retireAfterDays = 30,
    deleteStreamsAfterDays = 90,
    dryRun = false,
  } = opts
  
  const store = useStoreAdapter()
  const logger = useNventLogger('trigger-cleanup')
  const { SubjectPatterns } = useStreamTopics()
  const indexKey = SubjectPatterns.triggerIndex()
  
  const now = Date.now()
  const retireThreshold = now - (retireAfterDays * 24 * 60 * 60 * 1000)
  const deleteThreshold = now - (deleteStreamsAfterDays * 24 * 60 * 60 * 1000)
  
  const entries = await store.indexRead(indexKey)
  
  for (const entry of entries) {
    const metadata = entry.metadata
    
    // Check for retirement candidates
    if (
      metadata.status === 'active' &&
      metadata.stats.activeSubscribers === 0 &&
      metadata.lastActivityAt < retireThreshold
    ) {
      logger.info(`Retiring inactive trigger: ${entry.id}`)
      
      if (!dryRun) {
        await retireTrigger(entry.id, 'No subscribers for ${retireAfterDays} days')
      }
    }
    
    // Check for stream deletion candidates
    if (
      metadata.status === 'retired' &&
      metadata.retiredAt &&
      metadata.retiredAt < deleteThreshold
    ) {
      logger.info(`Deleting retired trigger stream: ${entry.id}`)
      
      if (!dryRun) {
        // Note: Stream deletion might not be supported by all adapters
        // Consider archiving instead
        const streamName = SubjectPatterns.trigger(entry.id)
        // await store.deleteStream(streamName) // If supported
      }
    }
  }
}

async function retireTrigger(triggerName: string, reason: string) {
  const store = useStoreAdapter()
  const { SubjectPatterns } = useStreamTopics()
  const indexKey = SubjectPatterns.triggerIndex()
  const streamName = SubjectPatterns.trigger(triggerName)
  
  // Get current metadata for stats
  const entry = await store.indexGet(indexKey, triggerName)
  if (!entry) return
  
  // Update index
  await store.indexUpdateWithRetry(indexKey, triggerName, {
    status: 'retired',
    retiredAt: Date.now(),
    retiredReason: reason,
  })
  
  // Append retirement event to stream
  await store.append(streamName, {
    type: 'trigger.retired',
    triggerName,
    data: {
      reason,
      finalStats: entry.metadata.stats,
      activeFor: Date.now() - entry.metadata.registeredAt,
    },
  })
}
```

## Migration Path

### Phase 1: Extend Store Interface (Already done)

✅ `indexAdd`, `indexGet`, `indexRead`, `indexUpdate`, `indexUpdateWithRetry`, `indexIncrement` already exist

### Phase 2: Update SubjectPatterns

1. Add `trigger(name)` and `triggerIndex()` patterns
2. Deprecate (comment out) old `triggers()` and `triggerSubscriptions()` patterns
3. Update imports across codebase

### Phase 3: Update Types

1. Add `status`, `stats`, `subscriptions` to `TriggerEntry` interface
2. Create new trigger event types
3. Update `RegisterTriggerOptions` and `SubscribeTriggerOptions`

### Phase 4: Update useTrigger

1. Replace all `store.save()` calls with `indexAdd` + `append`
2. Replace all `store.get()` calls with `indexGet`
3. Replace all `store.list()` calls with `indexRead`
4. Add statistics tracking on register/fire/subscribe
5. Implement subscription embedding in trigger metadata

### Phase 5: Update triggerWiring

1. Update initialization to load from index instead of docs
2. Update event handlers to maintain index + stream
3. Add trigger lifecycle tracking

### Phase 6: Create Migration Tool

Create `/scripts/migrate-triggers.ts`:

```typescript
// Read old doc-based triggers
const oldTriggers = await store.list('triggers')
const oldSubs = await store.list('trigger-subscriptions')

// Migrate to index + stream
for (const { id, doc } of oldTriggers) {
  await trigger.registerTrigger({
    name: id,
    type: doc.type,
    // ... map old fields
  })
}

for (const { doc } of oldSubs) {
  await trigger.subscribeTrigger({
    trigger: doc.trigger,
    flow: doc.flow,
    mode: doc.mode,
  })
}

// Archive old docs
// await store.delete('triggers', ...) for each
```

### Phase 7: Testing & Rollout

1. Test migration script on dev environment
2. Verify index queries work correctly
3. Verify trigger firing still works
4. Monitor performance improvements
5. Deploy to production

### Phase 8: Cleanup

1. Remove old doc-based code paths
2. Remove old `triggers` and `trigger-subscriptions` collection patterns
3. Update documentation
4. Add cleanup cron job for retired triggers

## Benefits

✅ **Performance**: Index queries instead of doc scans  
✅ **Audit Trail**: Full history in streams  
✅ **Lifecycle Management**: Clear active/retired states  
✅ **Statistics**: Built-in tracking of fires and subscribers  
✅ **Consistency**: Matches flow system architecture  
✅ **Scalability**: Optimistic locking with version field  
✅ **Cleanup**: Automated retirement of unused triggers  
✅ **Debuggability**: Stream replay for troubleshooting  

## API Compatibility

All existing `useTrigger()` methods maintain the same signatures:
- `registerTrigger(opts)` - Same API, different implementation
- `subscribeTrigger(opts)` - Same API, different implementation  
- `emitTrigger(name, data)` - Same API, different implementation
- `getTrigger(name)` - Same API, now uses index
- `getAllTriggers()` - Same API, now uses index
- `getSubscribedFlows(trigger)` - Same API, now uses embedded subscriptions

New methods added:
- `retireTrigger(name, reason)` - Explicitly retire a trigger
- `getTriggerStats(name)` - Get firing statistics
- `getTriggerHistory(name, opts)` - Read trigger stream events

## Future Enhancements

- Rate limiting based on trigger stats
- Trigger analytics dashboard
- Cross-instance trigger coordination via streams
- Trigger versioning (breaking changes)
- Trigger A/B testing support
