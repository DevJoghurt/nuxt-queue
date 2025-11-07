# Unified Event-Based Architecture

> **The Vision**: Everything is an Event in EventStore  
> **Status**: 📋 Planning (v0.6-v0.9)  
> **Last Updated**: 2025-11-05

## Overview

The nuxt-queue architecture is evolving towards a **single source of truth**: the eventStore. Instead of maintaining separate systems for state, logs, and registry, everything becomes an event stored in Redis Streams. This creates a unified, auditable, and scalable architecture.

## The Unified Model

### Before: Multiple Systems

```
┌─────────────────┐   ┌──────────────────┐   ┌─────────────────┐
│  Redis Streams  │   │  Redis Key-Value │   │  Redis Pub/Sub  │
│  (Flow Events)  │   │  (State Storage) │   │  (Logging)      │
└─────────────────┘   └──────────────────┘   └─────────────────┘
        +                     +                       +
┌─────────────────┐   ┌──────────────────┐
│  Custom Keys    │   │  Aggregation     │
│  (Registry)     │   │  Logic           │
└─────────────────┘   └──────────────────┘
```

**Problems**:
- Multiple systems to maintain
- Data can diverge between systems
- Complex cleanup (multiple TTLs)
- No unified timeline
- Performance overhead (multiple round-trips)

### After: Unified EventStore

```
┌───────────────────────────────────────────────────────────┐
│                      Redis Streams                        │
│                     (EventStore)                          │
├───────────────────────────────────────────────────────────┤
│                                                           │
│  nq:flow:{runId}           nq:registry                    │
│  ├─ flow.started           ├─ worker.registered          │
│  ├─ flow.step.started      ├─ worker.heartbeat           │
│  ├─ log.info               ├─ worker.deregistered        │
│  ├─ state.set              └─ (all instances)            │
│  ├─ log.debug                                            │
│  ├─ state.set                                            │
│  ├─ log.info                                             │
│  ├─ flow.step.completed                                  │
│  └─ flow.completed                                       │
│                                                           │
│  (complete timeline in one stream)                       │
└───────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │  EventStore       │
                    │  Adapter Layer    │
                    │  - Query caching  │
                    │  - Write-through  │
                    │  - TTL mgmt       │
                    └───────────────────┘
```

**Benefits**:
- ✅ Single source of truth
- ✅ Complete audit trail
- ✅ Time travel debugging
- ✅ Unified cleanup (one TTL)
- ✅ Simpler architecture
- ✅ Better performance (eventStore adapter provides transparent caching)

## The Evolution Path

### v0.5: Triggers as Events

**Goal**: Unified trigger system for starting flows and resuming paused steps.

```typescript
// Before: Limited scheduling in v0.4
await scheduleFlow('example-flow', { cron: '0 9 * * *' })

// After: Universal trigger system with events
registerTrigger({
  name: 'user.created',
  type: 'event',
  scope: 'flow',  // Entry trigger to start new runs
  schema: z.object({
    userId: z.string(),
    email: z.string().email()
  })
})

// Triggers stored as events in eventStore
await emitTrigger('user.created', { userId: '123', email: 'user@example.com' })
```

**Stream**: Triggers can use existing `nq:flow:{runId}` stream for await patterns, or start new flows.

**Trigger Types**:
- **Events**: Internal module events (type-safe, auto-discovery)
- **Webhooks**: External HTTP triggers (Stripe, GitHub, etc.)
- **Schedules**: Cron-based time triggers
- **Manual**: User-initiated from UI/API
- **Await**: Pause/resume patterns (approvals, delays)

**Benefits**:
- Unified way to start or resume flows
- Type-safe event schemas with Zod
- External webhook integration with auth
- Cron schedules with timezone support
- Human-in-the-loop patterns (approvals, delays)
- Reuses eventStore infrastructure

**Spec**: [v0.5/trigger-system.md](./v0.5/trigger-system.md)

### v0.6: State as Events

**Goal**: Eliminate separate state provider by storing state as events.

```typescript
// Before: Separate state storage
await redis.set(`state:${runId}:key`, value)

// After: State as events
{
  type: 'state.set',
  runId: 'abc-123',
  data: { key: 'accuracy', value: 0.95 }
}
```

**Stream**: `nq:flow:{runId}` contains state events mixed with flow events.

**Benefits**:
- Single source of truth for flow execution
- Audit trail of all state changes
- Time travel: reconstruct state at any timestamp
- Automatic cleanup with flow TTL

**Spec**: [v0.6/combined-state-management.md](./v0.6/combined-state-management.md)

### v0.8: Registry as Events

**Goal**: Replace custom registry system with event-based registry.

```typescript
// Before: Custom Redis keys + aggregation
await redis.set(`worker:${instanceId}:${workerId}`, JSON.stringify(worker))

// After: Registry as events
{
  type: 'worker.registered',
  instanceId: 'main-app-1',
  workerId: 'ml-worker',
  data: { queue: 'ml-train', flows: ['ml-pipeline'] }
}
```

**Stream**: `nq:registry` contains all instance/worker lifecycle events.

**Benefits**:
- Always-on distributed architecture
- No custom aggregation logic needed
- Instance discovery via event query
- Health monitoring via heartbeats
- Reuses existing eventStore infrastructure

**Spec**: [v0.8/distributed-architecture.md](./v0.8/distributed-architecture.md)

### v0.9: Logs as Events

**Goal**: Store logs in flow stream instead of separate log streams.

```typescript
// Before: Separate log streams or external only
console.log('Training started')

// After: Logs as events in flow stream
{
  type: 'log.info',
  runId: 'abc-123',
  message: 'Training started',
  timestamp: '2025-11-05T10:00:01Z'
}
```

**Stream**: `nq:flow:{runId}` contains log events mixed with flow events and state.

**Benefits**:
- Complete timeline (events + state + logs)
- Single source of truth for debugging
- Flexible routing (internal/external/both)
- Automatic cleanup with flow TTL
- Better debugging context

**Spec**: [v0.9/logging-enhancements.md](./v0.9/logging-enhancements.md)

## Complete Flow Timeline Example

With unified architecture, a single stream contains **everything**:

```typescript
// Stream: nq:flow:abc-123
// Complete timeline of entire flow execution:

{ type: 'flow.started', timestamp: '10:00:00', triggeredBy: 'user.created', ... }
{ type: 'flow.step.started', stepName: 'train', timestamp: '10:00:00', ... }
{ type: 'state.set', key: 'status', value: 'training', timestamp: '10:00:00', ... }
{ type: 'log.info', message: 'Training started', timestamp: '10:00:01', ... }

{ type: 'state.set', key: 'epoch', value: 1, timestamp: '10:00:02', ... }
{ type: 'state.set', key: 'accuracy', value: 0.85, timestamp: '10:00:02', ... }
{ type: 'log.debug', message: 'Epoch 1/10 complete', timestamp: '10:00:02', ... }

{ type: 'state.set', key: 'epoch', value: 2, timestamp: '10:00:03', ... }
{ type: 'state.set', key: 'accuracy', value: 0.92, timestamp: '10:00:03', ... }
{ type: 'log.debug', message: 'Epoch 2/10 complete', timestamp: '10:00:03', ... }

{ type: 'flow.step.paused', stepName: 'approve', timestamp: '10:00:10', ... }
{ type: 'trigger.awaiting', triggerName: 'approval.training', timestamp: '10:00:10', ... }
// ... (waiting for approval) ...
{ type: 'trigger.fired', triggerName: 'approval.training', timestamp: '11:30:00', ... }
{ type: 'flow.step.resumed', stepName: 'approve', timestamp: '11:30:00', ... }

{ type: 'log.info', message: 'Training complete', timestamp: '11:30:10', ... }
{ type: 'state.set', key: 'status', value: 'complete', timestamp: '11:30:10', ... }
{ type: 'flow.step.completed', stepName: 'train', timestamp: '11:30:10', ... }
{ type: 'flow.completed', timestamp: '11:30:10', ... }
```

**Query the timeline**:

```typescript
// Get everything
const timeline = await eventManager.query({
  stream: `nq:flow:abc-123`
})

// Get only state changes
const stateHistory = await eventManager.query({
  stream: `nq:flow:abc-123`,
  types: ['state.set', 'state.delete']
})

// Get only logs
const logs = await eventManager.query({
  stream: `nq:flow:abc-123`,
  types: ['log.info', 'log.warn', 'log.error']
})

// Get trigger events (when flow was triggered/resumed)
const triggers = await eventManager.query({
  stream: `nq:flow:abc-123`,
  types: ['trigger.fired', 'trigger.awaiting']
})

// Time travel: reconstruct state at T=10:00:03
const eventsUntil = await eventManager.query({
  stream: `nq:flow:abc-123`,
  endTime: '2025-11-05T10:00:03Z'
})
const pastState = reduceState(eventsUntil)
// { status: 'training', epoch: 2, accuracy: 0.92 }
```

## Storage Model Comparison

### Before (Separate Systems)

```
Per Flow Run:
├── nq:flow:{runId}                    (events only)
├── state:{runId}:key1                 (state storage)
├── state:{runId}:key2                 (state storage)
├── logs:{runId}                       (logs storage)
└── ... (multiple keys to manage)

Per Instance:
├── worker:{instanceId}:{workerId}     (registry)
├── worker:{instanceId}:heartbeat      (health)
└── ... (aggregation needed)

Total: 10-20+ keys per flow, complex cleanup
```

### After (Unified EventStore)

```
Per Flow Run:
└── nq:flow:{runId}                    (events + state + logs + triggers)

Global Registry:
└── nq:registry                        (all instances/workers)

Global Triggers:
└── nq:triggers                        (trigger registry and fired events)

Total: 1 key per flow + 2 global keys, automatic cleanup
```

**Storage Reduction**: ~90% fewer Redis keys

## Cache Layer Strategy

EventStore adapter provides transparent caching - application code never touches cache directly:

```typescript
// Write path (fast) - handled by eventStore adapter
async function setState(runId: string, key: string, value: any) {
  // EventStore adapter handles:
  // 1. Append event to stream (source of truth)
  // 2. Invalidate affected cache entries
  await eventStore.append(`nq:flow:${runId}`, {
    type: 'state.set',
    data: { key, value }
  })
}

// Read path (very fast) - handled by eventStore adapter
async function getState(runId: string, key: string) {
  // EventStore adapter handles:
  // 1. Check internal cache (1ms)
  // 2. Query Redis Streams if cache miss (50ms)
  // 3. Cache results automatically
  const events = await eventStore.query({
    stream: `nq:flow:${runId}`,
    types: ['state.set', 'state.delete']
  })
  
  const state = reduceState(events)
  return state[key]
}
```

**EventStore Adapter Architecture**:

```typescript
// src/runtime/server/eventStore/adapter.ts

export interface EventStoreAdapter {
  // Core operations
  append(stream: string, event: Event): Promise<void>
  query(options: QueryOptions): Promise<Event[]>
  
  // Adapter handles caching internally:
  // - Cache query results (configurable TTL)
  // - Invalidate on append
  // - Manage TTL based on stream status
}

// Application code only calls append() and query()
// Caching is completely transparent
```

**Performance**:
- Cache hit: ~1ms (adapter's internal cache)
- Cache miss: ~50ms (Redis Streams query + cache population)
- Cache hit rate: ~95% in typical workloads

**Configuration**:

```typescript
export default defineNuxtConfig({
  queue: {
    eventStore: {
      adapter: 'redis',  // or 'postgres', 'memory'
      cache: {
        enabled: true,
        ttl: {
          active: 86400,      // 24h for active flows
          completed: 604800,  // 7d for completed
          failed: 2592000     // 30d for failed (debugging)
        }
      }
    }
  }
})
```

**Benefits**:
- ✅ **Transparent**: Application code doesn't know about caching
- ✅ **Consistent**: All event types benefit from same caching
- ✅ **Adapter-Agnostic**: Works with Redis, Postgres, Memory adapters
- ✅ **No Manual Management**: Adapter handles invalidation automatically
- ✅ **Uniform Performance**: State, logs, events all cached the same way

## Benefits Summary

### For Developers

| Benefit | Description |
|---------|-------------|
| **Simple API** | Same simple `ctx.state.set()`, `ctx.logger.info()` - complexity hidden |
| **Time Travel** | Reconstruct state at any point in time for debugging |
| **Complete Timeline** | See everything that happened in chronological order |
| **Type Safety** | Full TypeScript support maintained |
| **Better Debugging** | Correlate state changes with logs and events |

### For Operations

| Benefit | Description |
|---------|-------------|
| **Single System** | Only Redis Streams, no separate state/log storage |
| **Automatic Cleanup** | Single TTL per flow handles everything |
| **Cost Efficient** | 90% fewer Redis keys, less memory usage |
| **Unified Monitoring** | One stream to monitor for all flow data |
| **Audit Trail** | Complete history for compliance/debugging |

### For Architecture

| Benefit | Description |
|---------|-------------|
| **Event Sourcing** | Industry-standard pattern for state management |
| **Consistency** | State/logs can't diverge (they ARE events) |
| **Scalability** | Cache layer provides performance at scale |
| **Flexibility** | Add new event types without schema changes |
| **Integration** | Everything works together seamlessly |

## Migration Path

### Phase 1: Add Event-Based Systems (v0.5-v0.9)

- ✅ Implement universal trigger system (v0.5)
- ✅ Implement state as events (v0.6)
- ✅ Implement registry as events (v0.8)
- ✅ Implement logs as events (v0.9)
- ⏳ Run in parallel with old systems (dual write)

### Phase 2: Feature Flags

```typescript
export default defineNuxtConfig({
  queue: {
    triggers: { enabled: true },            // v0.5 triggers
    state: { provider: 'eventStore' },      // 'redis' (old) | 'eventStore' (new)
    logging: { routing: 'internal' },       // 'console' (old) | 'internal' (new)
    registry: { mode: 'event-based' }       // Always event-based from v0.8
  }
})
```

### Phase 3: Deprecate Old Systems

- Remove old state provider
- Remove old logging adapters (keep external only)
- Remove v0.4 simple scheduling (replaced by v0.5 triggers)
- Registry is already event-based from v0.8

### Phase 4: Optimize

- Fine-tune cache TTLs
- Optimize event reduction performance
- Add snapshots for long-running flows

## Implementation Status

| Feature | Version | Status | Spec |
|---------|---------|--------|------|
| Universal Triggers | v0.5 | 📋 Planning | [v0.5/trigger-system.md](./v0.5/trigger-system.md) |
| State as Events | v0.6 | 📋 Planning | [v0.6/combined-state-management.md](./v0.6/combined-state-management.md) |
| Registry as Events | v0.8 | 📋 Planning | [v0.8/distributed-architecture.md](./v0.8/distributed-architecture.md) |
| Logs as Events | v0.9 | 📋 Planning | [v0.9/logging-enhancements.md](./v0.9/logging-enhancements.md) |
| Cache Layer | v0.6-v0.9 | 📋 Planning | Covered in each spec |
| Migration Tools | TBD | 🔮 Future | TBD |

## Future Enhancements

### Trigger System Features (v0.5)

The universal trigger system provides advanced flow control:

```typescript
// Entry Triggers (start new flows)
registerTrigger({
  name: 'stripe.payment.succeeded',
  type: 'webhook',
  scope: 'flow',
  endpoint: { path: '/webhooks/stripe', method: 'POST' }
})

// Await Triggers (pause/resume flows)
export default defineQueueWorker(async (job, ctx) => {
  // Do work...
  ctx.logger.info('Awaiting approval')
  
  // Pause and wait for trigger
  const approval = await ctx.flow.await('manager.approval', {
    timeout: '24h',
    data: { amount: 10000, reason: 'Large payment' }
  })
  
  if (approval.approved) {
    // Continue processing
  }
})
```

**Trigger Types**:
- **Events**: Type-safe module events with Zod schemas
- **Webhooks**: External HTTP with signature verification (Stripe, GitHub, etc.)
- **Schedules**: Cron patterns with timezone support
- **Manual**: User-initiated from UI/API
- **Await**: Human-in-the-loop patterns (approvals, delays)

**Storage in EventStore**:
- Trigger registry: `nq:triggers` stream (global)
- Trigger events: `nq:flow:{runId}` stream (per-flow)
- Await state: Events in flow stream show pause/resume

### Snapshots (Performance Optimization)

For long-running flows with thousands of events:

```typescript
{
  type: 'state.snapshot',
  timestamp: '2025-11-05T12:00:00Z',
  data: {
    // Complete state at this point
    epoch: 500,
    accuracy: 0.92,
    status: 'training'
  }
}

// Reconstruction only needs events after last snapshot
```

### Multi-Backend Support

EventStore adapter interface supports multiple backends:

- ✅ Redis Streams (default)
- 🚧 PostgreSQL (v0.6 planned)
- 🔮 Kafka (future)
- 🔮 Memory (testing)

### Cross-Flow Queries

Query across multiple flows:

```typescript
// Find all flows that failed with specific error
const failedFlows = await eventManager.queryGlobal({
  pattern: 'nq:flow:*',
  types: ['flow.failed'],
  filter: (event) => event.data.error.includes('OutOfMemory')
})
```

## Conclusion

The unified event-based architecture simplifies nuxt-queue by making everything an event in the eventStore. This creates a single source of truth, complete audit trail, and better developer experience - all while improving performance through a smart cache layer.

From v0.5 onwards, triggers become events, state becomes events, logs become events, and the registry becomes events. Everything flows through Redis Streams, creating a unified timeline that captures the complete history of flows, instances, and interactions.

**Core Principle**: Events are the source of truth. Everything else is derived state.

**Key Features**:
- 🎪 **v0.5**: Universal triggers (events, webhooks, schedules, await)
- 📋 **v0.6**: State as events (event sourcing)
- 🌐 **v0.8**: Registry as events (distributed)
- 📊 **v0.9**: Logs as events (complete timeline)

---

**Status**: 📋 Planning  
**Target**: v0.5-v0.9  
**Last Updated**: 2025-11-05
