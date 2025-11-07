# State Management Enhancements

> **Version**: v0.6.2  
> **Status**: 📋 Planning  
> **Last Updated**: 2025-11-05  
> **Integrates With**: v0.8 (Event-Based Registry), v0.9 (Logging)

## Overview

v0.6 introduces unified state management by storing state as events in the stream store. This eliminates the separate state provider and creates a single source of truth for all flow data. State is stored in the same `nq:flow:{runId}` stream alongside flow events and logs (v0.9), making the stream the complete timeline of everything that happens in a flow run.

This is the foundation for the unified event-based architecture:
- **v0.6**: State as events (`state.set`, `state.delete`, `state.batch`)
- **v0.8**: Registry as events (`worker.registered`, `worker.heartbeat`) in `nq:registry`
- **v0.9**: Logs as events (`log.info`, `log.warn`, `log.error`) in `nq:flow:{runId}`

**Result**: Everything is an event in eventStore - one system to rule them all.

### Key Features

1. **Unified Storage** - State operations stored as events, not separate key-value storage
2. **Single Stream Pattern** - State events in `nq:flow:{runId}` with all flow data
3. **Event Sourcing** - State reconstructed by reducing events
4. **EventStore Cache** - Performance optimization via eventStore adapter's internal caching
5. **Automatic Cleanup** - State cleaned up when flow stream expires


## 1. Unified State and Stream Store

### Goal

Eliminate the separate state provider by storing state as events in the `nq:flow:{runId}` stream, creating a single source of truth for all flow data (events, state, and logs).

### Current Problem

We have two separate systems:
1. **Stream Store**: Events in Redis Streams (`nq:flow:{runId}`)
2. **State Provider**: Key-value in Redis (separate keys)

This creates:
- **Complexity**: Two systems to maintain
- **Inconsistency**: State and events can diverge
- **Performance overhead**: Two round-trips for related operations
- **Cleanup complexity**: Must manage TTL for both systems separately
- **No audit trail**: State changes not in event timeline

### Proposed Solution

Store state operations as events in the same `nq:flow:{runId}` stream used for flow events:

```typescript
// Worker code - simple state API
await ctx.state.set('model_version', '1.0')
await ctx.state.set('accuracy', 0.95)

// Behind the scenes, becomes events in nq:flow:abc-123:
{
  type: 'state.set',
  runId: 'abc-123',
  flowName: 'ml-flow',
  stepName: 'train_model',
  timestamp: '2025-11-05T10:00:00Z',
  data: {
    key: 'model_version',
    value: '1.0'
  }
}
{
  type: 'state.set',
  runId: 'abc-123',
  flowName: 'ml-flow',
  stepName: 'train_model',
  timestamp: '2025-11-05T10:00:01Z',
  data: {
    key: 'accuracy',
    value: 0.95
  }
}
```

### Complete Flow Timeline (Single Stream)

All flow data in one stream creates a complete timeline:

```typescript
// Stream: nq:flow:abc-123
// Timeline of EVERYTHING that happens in this flow run:

{ type: 'flow.started', timestamp: '10:00:00', ... }
{ type: 'flow.step.started', stepName: 'train', timestamp: '10:00:00', ... }
{ type: 'log.info', message: 'Training started', timestamp: '10:00:01', ... }
{ type: 'state.set', key: 'status', value: 'training', timestamp: '10:00:01', ... }
{ type: 'log.debug', message: 'Epoch 1/10', timestamp: '10:00:02', ... }
{ type: 'state.set', key: 'epoch', value: 1, timestamp: '10:00:02', ... }
{ type: 'state.set', key: 'accuracy', value: 0.85, timestamp: '10:00:02', ... }
{ type: 'log.debug', message: 'Epoch 2/10', timestamp: '10:00:03', ... }
{ type: 'state.set', key: 'epoch', value: 2, timestamp: '10:00:03', ... }
{ type: 'state.set', key: 'accuracy', value: 0.92, timestamp: '10:00:03', ... }
{ type: 'log.info', message: 'Training complete', timestamp: '10:00:10', ... }
{ type: 'state.set', key: 'status', value: 'complete', timestamp: '10:00:10', ... }
{ type: 'flow.step.completed', stepName: 'train', timestamp: '10:00:10', ... }
{ type: 'flow.completed', timestamp: '10:00:10', ... }

// Single stream = single source of truth for entire flow execution
```

### State Reconstruction

Current state is computed by reducing events (event sourcing pattern):

```typescript
function reduceState(events: EventRecord[]): Record<string, any> {
  const state = {}
  
  for (const event of events) {
    if (event.type === 'state.set') {
      state[event.data.key] = event.data.value
    } else if (event.type === 'state.delete') {
      delete state[event.data.key]
    }
  }
  
  return state
}

// Example: Reconstruct state at any point in time
const allEvents = await streamStore.read('nq:flow:abc-123')
const finalState = reduceState(allEvents)
// { status: 'complete', epoch: 2, accuracy: 0.92, model_version: '1.0' }

// Time travel: Reconstruct state at specific timestamp
const eventsUntil = allEvents.filter(e => e.timestamp <= '10:00:03')
const pastState = reduceState(eventsUntil)
// { status: 'training', epoch: 2, accuracy: 0.92 }
```

### State Event Types

```typescript
// Set a state value
{
  type: 'state.set',
  runId: string,
  flowName: string,
  stepName: string,
  timestamp: string,
  data: {
    key: string,
    value: any,
    previousValue?: any  // Optional for audit trail
  }
}

// Delete a state value
{
  type: 'state.delete',
  runId: string,
  flowName: string,
  stepName: string,
  timestamp: string,
  data: {
    key: string,
    previousValue?: any  // Optional for audit trail
  }
}

// Batch set multiple values (optimization)
{
  type: 'state.batch',
  runId: string,
  flowName: string,
  stepName: string,
  timestamp: string,
  data: {
    operations: Array<{
      type: 'set' | 'delete',
      key: string,
      value?: any
    }>
  }
}
```

### Performance Optimization

EventStore adapter provides built-in caching for performance:

```typescript
// Write-through cache (handled by eventStore adapter)
async function setState(runId: string, key: string, value: any) {
  const stream = `nq:flow:${runId}`
  
  // EventStore adapter handles both:
  // 1. Append event to stream (source of truth)
  // 2. Update internal cache (transparent to caller)
  await eventStore.append(stream, {
    type: 'state.set',
    data: { key, value }
  })
}

// Read-through cache (handled by eventStore adapter)
async function getState(runId: string, key: string) {
  const stream = `nq:flow:${runId}`
  
  // EventStore adapter handles:
  // 1. Check internal cache (fast path - ~1ms)
  // 2. Query stream if cache miss (slow path - ~50ms)
  // 3. Populate cache automatically
  const events = await eventStore.query({
    stream,
    types: ['state.set', 'state.delete', 'state.batch']
  })
  
  const state = reduceState(events)
  return state[key]
}

// Get all state (optimized by eventStore)
async function getAllState(runId: string) {
  const stream = `nq:flow:${runId}`
  
  // EventStore adapter's query method uses internal cache
  // Cache hit: returns cached events (~1ms)
  // Cache miss: queries Redis Streams, caches results (~50ms)
  const events = await eventStore.query({
    stream,
    types: ['state.set', 'state.delete', 'state.batch']
  })
  
  return reduceState(events)
}
```

**EventStore Adapter Benefits**:
- **Transparent Caching**: Application code doesn't need to know about caching
- **Unified Interface**: Same `eventStore.append()` and `eventStore.query()` API
- **Smart Invalidation**: Adapter manages cache lifecycle automatically
- **Consistent**: All event access goes through same cached layer

### Cache Invalidation

EventStore adapter manages cache TTL automatically based on flow status:

```typescript
// Configure eventStore cache behavior
export default defineNuxtConfig({
  queue: {
    eventStore: {
      adapter: 'redis',  // or 'postgres', 'memory'
      cache: {
        enabled: true,
        ttl: {
          active: 86400,      // 24 hours for active flows
          completed: 604800,  // 7 days for completed flows
          failed: 2592000     // 30 days for failed flows (debugging)
        }
      }
    }
  }
})

// EventStore adapter automatically:
// 1. Caches events on read (query)
// 2. Invalidates cache on write (append)
// 3. Adjusts TTL based on flow status
// 4. Cleans up when stream expires
```

**No Manual Cache Management**:
- Application code never touches cache directly
- EventStore adapter handles all caching internally
- Same behavior across all adapters (Redis, Postgres, Memory)
- Consistent performance characteristics

### Benefits

1. **Single Source of Truth**
   - All flow data (events, state, logs) in one stream
   - Stream is the complete timeline of flow execution
   - No data synchronization issues

2. **Auditability**
   - Full history of state changes with timestamps
   - See when and where each state change happened
   - Correlate state changes with events and logs

3. **Time Travel**
   - Reconstruct state at any point in time
   - Debug by replaying events up to failure point
   - Compare state across different execution timestamps

4. **Simplicity**
   - One system instead of two (no separate state provider)
   - Single Redis key pattern: `nq:flow:{runId}`
   - Unified cleanup (stream TTL applies to everything)

5. **Consistency**
   - State and events always in sync (state IS events)
   - No race conditions between state and event updates
   - Atomic operations via stream append

6. **Performance**
   - EventStore adapter provides transparent caching (~1ms cache hits)
   - Batch operations for multiple state changes
   - Filter events by type for efficient state reconstruction
   - No manual cache management required

7. **Integration**
   - Works seamlessly with v0.9 logging (same stream)
   - Compatible with v0.8 event-based registry
   - Query state alongside events and logs

### Comparison: Before vs After

| Aspect | Before (Separate State) | After (Event-Based State) |
|--------|------------------------|---------------------------|
| **Storage** | Two systems (stream + KV) | One system (stream only) |
| **Keys** | `nq:flow:{runId}` + `nq:state:{runId}:*` | `nq:flow:{runId}` only |
| **Cleanup** | Two TTLs to manage | Single stream TTL |
| **Audit** | No history | Full event history |
| **Consistency** | Can diverge | Always in sync |
| **Query** | Separate queries | Unified timeline query |
| **Debugging** | State at failure only | State at any timestamp |

## 2. Worker Context API

The `ctx.state` API remains simple, hiding event-sourcing complexity:

```typescript
export default defineQueueWorker(async (job, ctx) => {
  // Set state (appends state.set event)
  await ctx.state.set('status', 'processing')
  await ctx.state.set('progress', 0)
  
  // Get state (from cache or event reduction)
  const status = await ctx.state.get('status')  // 'processing'
  
  // Get all state
  const allState = await ctx.state.getAll()
  // { status: 'processing', progress: 0 }
  
  // Check if key exists
  const hasStatus = await ctx.state.has('status')  // true
  
  // Delete state (appends state.delete event)
  await ctx.state.delete('tempData')
  
  // Batch operations (single state.batch event)
  await ctx.state.setBatch({
    status: 'complete',
    progress: 100,
    result: { accuracy: 0.95 }
  })
  
  return { status: 'done' }
})
```

### Type-Safe State

```typescript
// Define state schema
interface TrainingState {
  status: 'idle' | 'training' | 'complete'
  epoch: number
  accuracy: number
  model_version: string
}

export default defineQueueWorker<JobData, TrainingState>(async (job, ctx) => {
  // TypeScript ensures correct types
  await ctx.state.set('status', 'training')  // ✓
  await ctx.state.set('status', 'invalid')   // ✗ Type error
  
  const accuracy = await ctx.state.get('accuracy')  // number
})
```

### State Scoping

State is scoped to flow run (`runId`):

```typescript
// Two parallel runs of same flow have separate state
// Run 1: nq:flow:run-abc
await ctx.state.set('progress', 50)  // Only affects run-abc

// Run 2: nq:flow:run-xyz
await ctx.state.set('progress', 75)  // Only affects run-xyz

// Each run has isolated state in its own stream
```

## 3. Implementation

### EventStore Adapter

```typescript
// src/runtime/server/state/eventStore.ts

export class EventStoreStateProvider implements StateProvider {
  constructor(
    private eventStore: EventStore  // Uses eventStore adapter with built-in caching
  ) {}
  
  async get(runId: string, key: string): Promise<any> {
    const stream = `nq:flow:${runId}`
    
    // Query through eventStore adapter (uses internal cache)
    const events = await this.eventStore.query({
      stream,
      types: ['state.set', 'state.delete', 'state.batch']
    })
    
    // Reduce events to current state
    const state = this.reduceState(events)
    
    return state[key]
  }
  
  async set(runId: string, key: string, value: any): Promise<void> {
    const stream = `nq:flow:${runId}`
    
    // Append through eventStore adapter (auto-invalidates cache)
    await this.eventStore.append(stream, {
      type: 'state.set',
      data: { key, value }
    })
  }
  
  async getAll(runId: string): Promise<Record<string, any>> {
    const stream = `nq:flow:${runId}`
    
    // Query through eventStore adapter (uses internal cache)
    const events = await this.eventStore.query({
      stream,
      types: ['state.set', 'state.delete', 'state.batch']
    })
    
    return this.reduceState(events)
  }
  
  async delete(runId: string, key: string): Promise<void> {
    const stream = `nq:flow:${runId}`
    
    // Append through eventStore adapter (auto-invalidates cache)
    await this.eventStore.append(stream, {
      type: 'state.delete',
      data: { key }
    })
  }
  
  async setBatch(runId: string, updates: Record<string, any>): Promise<void> {
    const stream = `nq:flow:${runId}`
    
    // Single state.batch event (optimization)
    await this.eventStore.append(stream, {
      type: 'state.batch',
      data: {
        operations: Object.entries(updates).map(([key, value]) => ({
          type: 'set',
          key,
          value
        }))
      }
    })
  }
  
  private reduceState(events: Event[]): Record<string, any> {
    const state: Record<string, any> = {}
    
    for (const event of events) {
      if (event.type === 'state.set') {
        state[event.data.key] = event.data.value
      } else if (event.type === 'state.delete') {
        delete state[event.data.key]
      } else if (event.type === 'state.batch') {
        for (const op of event.data.operations) {
          if (op.type === 'set') {
            state[op.key] = op.value
          } else if (op.type === 'delete') {
            delete state[op.key]
          }
        }
      }
    }
    
    return state
  }
}
```

**Key Points**:
- ✅ **No Direct Cache Access**: State provider only talks to eventStore adapter
- ✅ **Transparent Caching**: EventStore adapter handles all caching internally
- ✅ **Simple Code**: Just `append()` and `query()` - no cache management
- ✅ **Adapter Agnostic**: Works with any eventStore adapter (Redis, Postgres, Memory)

### Worker Context Integration

```typescript
// src/runtime/server/worker/context.ts

export function createWorkerContext(
  job: Job,
  provider: QueueProvider,
  worker: WorkerConfig
): WorkerContext {
  const eventStore = getEventStore()  // Get configured eventStore adapter
  const stateProvider = new EventStoreStateProvider(eventStore)
  
  return {
    state: {
      get: (key: string) => stateProvider.get(job.data.runId, key),
      set: (key: string, value: any) => stateProvider.set(job.data.runId, key, value),
      getAll: () => stateProvider.getAll(job.data.runId),
      delete: (key: string) => stateProvider.delete(job.data.runId, key),
      has: async (key: string) => {
        const value = await stateProvider.get(job.data.runId, key)
        return value !== undefined
      },
      setBatch: (updates: Record<string, any>) => 
        stateProvider.setBatch(job.data.runId, updates)
    },
    flow: createFlowContext(job, provider),
    logger: createLogger(job),
    provider
  }
}
```

## 4. Query Interface

Query state alongside events and logs using eventStore adapter:

```typescript
// Get complete flow timeline (events + state + logs)
// EventStore adapter uses internal cache for fast queries
const timeline = await eventStore.query({
  stream: `nq:flow:${runId}`
})

// Filter for state changes only
const stateChanges = await eventStore.query({
  stream: `nq:flow:${runId}`,
  types: ['state.set', 'state.delete', 'state.batch']
})

// Get state at specific timestamp (time travel)
const eventsUntil = await eventStore.query({
  stream: `nq:flow:${runId}`,
  endTime: '2025-11-05T10:00:03Z'
})
const pastState = reduceState(eventsUntil.filter(e => 
  ['state.set', 'state.delete', 'state.batch'].includes(e.type)
))

// Correlate state changes with logs
const correlation = await eventStore.query({
  stream: `nq:flow:${runId}`,
  types: ['state.set', 'log.info', 'log.error']
})
// See state changes and logs interleaved in timeline
```

**EventStore Benefits**:
- All queries go through same cached adapter
- Consistent performance across state, logs, and events
- No need to manage multiple cache layers

## 5. Migration Strategy

### Phase 1: Dual Write (Backwards Compatible)

```typescript
// Write to both old and new systems
async function setState(runId: string, key: string, value: any) {
  // Old system (deprecated)
  await oldStateProvider.set(runId, key, value)
  
  // New system (event-based)
  await eventStoreStateProvider.set(runId, key, value)
}

// Read from old system (cached) or new system (fallback)
async function getState(runId: string, key: string) {
  // Try old system first
  const value = await oldStateProvider.get(runId, key)
  if (value !== undefined) return value
  
  // Fall back to new system
  return await eventStoreStateProvider.get(runId, key)
}
```

### Phase 2: Feature Flag

```typescript
export default defineNuxtConfig({
  queue: {
    state: {
      provider: 'eventStore'  // 'redis' (old) | 'eventStore' (new)
    }
  }
})
```

### Phase 3: Remove Old Provider

```typescript
// Remove old state provider completely
// Use only event-based state
```

## 6. Configuration

```typescript
export default defineNuxtConfig({
  queue: {
    state: {
      provider: 'eventStore',  // Use event-based state
    },
    eventStore: {
      adapter: 'redis',  // or 'postgres', 'memory'
      cache: {
        enabled: true,
        ttl: {
          active: 86400,      // 24 hours
          completed: 604800,  // 7 days
          failed: 2592000     // 30 days
        }
      }
    }
  }
})
```

**Note**: Cache configuration is at eventStore level, not state level. This ensures consistent caching behavior for all event types (flow events, state events, log events).

## 7. Testing Strategy

```typescript
// test/state-event-sourcing.test.ts

describe('Event-Based State', () => {
  it('stores state as events', async () => {
    await ctx.state.set('key', 'value')
    
    const events = await eventManager.query({
      stream: `nq:flow:${runId}`,
      types: ['state.set']
    })
    
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'state.set',
      data: { key: 'key', value: 'value' }
    })
  })
  
  it('reconstructs state from events', async () => {
    await ctx.state.set('a', 1)
    await ctx.state.set('b', 2)
    await ctx.state.delete('a')
    await ctx.state.set('c', 3)
    
    const state = await ctx.state.getAll()
    
    expect(state).toEqual({ b: 2, c: 3 })
  })
  
  it('supports time travel', async () => {
    await ctx.state.set('value', 1)
    const t1 = Date.now()
    
    await ctx.state.set('value', 2)
    const t2 = Date.now()
    
    await ctx.state.set('value', 3)
    
    // Get state at t1
    const stateAtT1 = await getStateAt(runId, new Date(t1))
    expect(stateAtT1.value).toBe(1)
    
    // Get state at t2
    const stateAtT2 = await getStateAt(runId, new Date(t2))
    expect(stateAtT2.value).toBe(2)
  })
  
  it('caches for performance', async () => {
    await ctx.state.set('key', 'value')
    
    // First read: eventStore adapter queries stream
    const value1 = await ctx.state.get('key')
    
    // Second read: eventStore adapter returns cached events
    const value2 = await ctx.state.get('key')
    
    expect(value1).toBe('value')
    expect(value2).toBe('value')
    
    // Both calls use eventStore adapter's internal cache
    // No direct cache access from application code
  })
})

## 8. Benefits Summary

### For Developers

- **Simple API**: `ctx.state.set()` / `ctx.state.get()` - no complexity exposed
- **Type Safety**: Full TypeScript support with state schemas
- **Debugging**: Time travel to any point in flow execution
- **Correlation**: See state changes alongside logs and events

### For Operations

- **Single System**: Only Redis Streams via eventStore adapter, no separate state storage
- **Unified Monitoring**: All flow data in one stream
- **Automatic Cleanup**: Stream TTL handles everything
- **Cost Efficient**: Less Redis memory (one key per flow instead of many)
- **Consistent Caching**: EventStore adapter handles all caching uniformly

### For Architecture

- **Event Sourcing**: Industry-standard pattern for state management
- **Auditability**: Complete history of all state changes
- **Consistency**: State and events can't diverge (state IS events)
- **Integration**: Works seamlessly with v0.8 registry and v0.9 logging
- **Adapter Pattern**: EventStore adapter abstracts storage and caching

## 9. Performance Characteristics

| Operation | Without Cache | With Cache | Notes |
|-----------|--------------|------------|-------|
| `state.get()` | ~50ms | ~1ms | EventStore adapter cache hit is 50x faster |
| `state.set()` | ~5ms | ~5ms | Stream append + cache invalidation |
| `state.getAll()` | ~100ms | ~10ms | Cached events reduce reconstruction time |
| `state.setBatch()` | ~10ms | ~10ms | Single stream append |

**Cache Hit Rate**: ~95% in typical workloads (state read more than written)

**Note**: All caching handled transparently by eventStore adapter. Application code sees consistent performance without managing cache.

## 10. Complete Example

```typescript
// server/queues/ml-training.ts

interface TrainingState {
  status: 'idle' | 'training' | 'evaluating' | 'complete'
  epoch: number
  totalEpochs: number
  accuracy: number
  loss: number
  startTime: string
}

export default defineQueueWorker<TrainingData, TrainingState>(async (job, ctx) => {
  // Initialize state
  await ctx.state.setBatch({
    status: 'training',
    epoch: 0,
    totalEpochs: job.data.epochs,
    accuracy: 0,
    loss: 0,
    startTime: new Date().toISOString()
  })
  
  ctx.logger.info('Training started')
  
  // Training loop
  for (let epoch = 1; epoch <= job.data.epochs; epoch++) {
    const result = await trainEpoch(job.data, epoch)
    
    // Update state (creates state.set events)
    await ctx.state.setBatch({
      epoch,
      accuracy: result.accuracy,
      loss: result.loss
    })
    
    ctx.logger.debug(`Epoch ${epoch}/${job.data.epochs}`, {
      accuracy: result.accuracy,
      loss: result.loss
    })
    
    // Check if another step needs current progress
    const currentAccuracy = await ctx.state.get('accuracy')
    if (currentAccuracy > 0.95) {
      ctx.logger.info('Target accuracy reached')
      break
    }
  }
  
  // Final state
  await ctx.state.set('status', 'complete')
  ctx.logger.info('Training complete')
  
  // Return final state
  return await ctx.state.getAll()
})

// Query complete timeline later (via eventStore adapter):
const timeline = await eventStore.query({
  stream: `nq:flow:${runId}`
})

// Timeline shows everything that happened:
// { type: 'flow.step.started', stepName: 'train', ... }
// { type: 'state.batch', data: { operations: [...] }, ... }  <- Initial state
// { type: 'log.info', message: 'Training started', ... }
// { type: 'state.batch', data: { operations: [...] }, ... }  <- Epoch 1 state
// { type: 'log.debug', message: 'Epoch 1/10', ... }
// { type: 'state.batch', data: { operations: [...] }, ... }  <- Epoch 2 state
// { type: 'log.debug', message: 'Epoch 2/10', ... }
// ...
// { type: 'state.set', data: { key: 'status', value: 'complete' }, ... }
// { type: 'log.info', message: 'Training complete', ... }
// { type: 'flow.step.completed', stepName: 'train', ... }
```

## 11. Implementation Checklist

- [ ] Create `EventStoreStateProvider` class
- [ ] Implement `state.set`, `state.get`, `state.delete` event types
- [ ] Add `state.batch` event type for bulk operations
- [ ] Integrate with eventStore adapter (no direct cache management)
- [ ] Add state reconstruction (event reduction)
- [ ] Update worker context to use new state provider
- [ ] Add configuration options (state provider selection)
- [ ] Implement migration strategy (dual write)
- [ ] Add feature flag for gradual rollout
- [ ] Write tests for event sourcing
- [ ] Write tests for eventStore adapter caching behavior
- [ ] Write tests for time travel queries
- [ ] Document API and migration guide
- [ ] Update examples to show state + events + logs in single stream
- [ ] Performance benchmarking (with/without eventStore cache)

## 12. Future Enhancements

### Snapshots (Optimization)

For long-running flows with many state changes:

```typescript
// Periodic snapshots to speed up reconstruction
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
function reduceState(events: Event[]) {
  const lastSnapshot = events.findLast(e => e.type === 'state.snapshot')
  const state = lastSnapshot ? { ...lastSnapshot.data } : {}
  
  // Only reduce events after snapshot
  const eventsAfterSnapshot = lastSnapshot 
    ? events.slice(events.indexOf(lastSnapshot) + 1)
    : events
  
  for (const event of eventsAfterSnapshot) {
    // ... reduce state changes
  }
  
  return state
}
```

### State Validation

Validate state changes using Zod schemas in `defineQueueConfig`:

```typescript
// server/queues/ml-training.ts
import { z } from 'zod'

// Define state schema for validation
const stateSchema = z.object({
  status: z.enum(['idle', 'training', 'evaluating', 'complete']),
  epoch: z.number().int().min(0),
  totalEpochs: z.number().int().positive(),
  accuracy: z.number().min(0).max(1),
  loss: z.number().min(0),
  startTime: z.string().datetime()
})

export const config = defineQueueConfig({
  state: stateSchema
})

export default defineQueueWorker(async (job, ctx) => {
  // State changes are automatically validated
  await ctx.state.set('status', 'training')  // ✓ Valid
  await ctx.state.set('status', 'invalid')   // ✗ Throws validation error
  
  await ctx.state.set('accuracy', 0.95)      // ✓ Valid
  await ctx.state.set('accuracy', 1.5)       // ✗ Throws validation error (> 1)
  
  // Batch operations also validated
  await ctx.state.setBatch({
    epoch: 1,
    accuracy: 0.85,
    loss: 0.15
  })  // ✓ All valid
  
  return { status: 'complete' }
})
```

**Benefits**:
- **Type Safety**: Full TypeScript inference from Zod schema
- **Runtime Validation**: Prevents invalid state at write time
- **Self-Documenting**: Schema shows valid state structure
- **IDE Support**: Autocomplete for state keys and values
- **Consistent**: Same pattern as job data validation

**Validation Flow**:
```typescript
// Internal implementation
async function setState(key: string, value: any) {
  // 1. Get state schema from flow config
  const schema = flowConfig.state
  
  // 2. Validate single field
  const fieldSchema = schema.shape[key]
  const validated = fieldSchema.parse(value)
  
  // 3. If valid, append event
  await eventStore.append(stream, {
    type: 'state.set',
    data: { key, value: validated }
  })
}
```

**Partial Validation**:
```typescript
// Optional: Allow partial state (not all fields required)
const stateSchema = z.object({
  status: z.enum(['idle', 'training', 'complete']),
  accuracy: z.number().optional(),  // Optional field
  metadata: z.record(z.any())       // Flexible metadata
}).partial()  // All fields optional

export const config = defineQueueConfig({
  name: 'my-flow',
  state: stateSchema
})

export default defineQueueWorker(async (job, ctx) => {
  // Can set fields incrementally
  await ctx.state.set('status', 'training')
  // accuracy not set yet - valid
  
  await ctx.state.set('accuracy', 0.85)
  // Now both set - still valid
})
```

### State Persistence Beyond Flow TTL

```typescript
// Archive important state to external storage
export default defineNuxtConfig({
  queue: {
    state: {
      archive: {
        enabled: true,
        filter: (state, flowName) => flowName === 'ml-training',
        storage: 's3',
        options: {
          bucket: 'flow-state-archive'
        }
      }
    }
  }
})
```

