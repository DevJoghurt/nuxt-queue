# Adapter Utils Migration Guide

## Overview

The monorepo refactoring introduces a new three-adapter architecture that replaces the old `EventStoreAdapter` pattern.

## Architecture Comparison

### OLD (v0.4 - Current)
```typescript
// Single EventStoreAdapter handles everything
const store = useEventStore()
await store.adapter.append(stream, event)  // Storage
await store.adapter.subscribe(stream, cb)  // In-process subscription
// No cross-instance pub/sub
```

### NEW (Monorepo Refactoring)
```typescript
// Three separate adapters with clear responsibilities
const queue = useQueueAdapter()  // Job queue operations
const stream = useStreamAdapter() // Cross-instance pub/sub
const store = useStoreAdapter()   // Storage (events, docs, KV)

await store.append(subject, event)      // Storage
await stream.subscribe(topic, handler)  // Cross-instance pub/sub
store.subscribe?.(subject, cb)          // Optional in-process subscription
```

## Migration Strategy

### Phase 1: Parallel Implementation ✅ (Current)
- OLD system (`events/` directory) remains functional
- NEW system (`adapters/` directory) implemented alongside
- APIs use OLD system via `useEventStore()`, `useQueue()`
- No breaking changes

### Phase 2: Update Utils (Next Step)
- Create new utilities for adapter access
- Keep OLD utils for backward compatibility
- Mark OLD utils as `@deprecated`

### Phase 3: Migrate APIs
- Update API endpoints to use new adapters
- Update WebSocket handlers
- Update FlowWiring

### Phase 4: Remove OLD System
- Delete `events/` directory
- Remove deprecated utils
- Clean up imports

## New Utilities

### Core Adapters
```typescript
import { useQueueAdapter, useStreamAdapter, useStoreAdapter } from '#imports'

// Queue operations (replaces useQueue)
const queue = useQueueAdapter()
await queue.enqueue('my-queue', { name: 'job', data: {...} })

// Cross-instance pub/sub (NEW - no old equivalent)
const stream = useStreamAdapter()
await stream.subscribe('store:append:*', (event) => {
  console.log('Cross-instance event:', event)
})

// Storage operations (replaces useEventStore)
const store = useStoreAdapter()
await store.append('nq:flow:abc', { type: 'step.completed', data: {...} })
const events = await store.read('nq:flow:abc')
await store.save('flow-metadata', 'run-123', { status: 'completed' })
await store.kv.set('key', 'value')
await store.indexAdd('nq:flows:example', 'run-123', Date.now())
```

### Compatibility Wrappers
```typescript
// OLD (still works, deprecated)
import { useEventStore } from '#imports'
const store = useEventStore()
await store.adapter.append(...)

// NEW (recommended)
import { useStoreAdapter } from '#imports'
const store = useStoreAdapter()
await store.append(...)
```

## API Migration Examples

### Example 1: List Flow Runs

**Before (OLD):**
```typescript
// api/_flows/[name]/runs.get.ts
import { useEventStore } from '#imports'

export default defineEventHandler(async (event) => {
  const store = useEventStore()
  const flowName = getRouterParam(event, 'name')
  
  // Read from index
  const runs = await store.indexRead(`nq:flows:${flowName}`, { limit: 50 })
  
  return { runs }
})
```

**After (NEW):**
```typescript
// api/_flows/[name]/runs.get.ts
import { useStoreAdapter } from '#imports'

export default defineEventHandler(async (event) => {
  const store = useStoreAdapter()
  const flowName = getRouterParam(event, 'name')
  
  // Same API, different import
  const runs = await store.indexRead(`nq:flows:${flowName}`, { limit: 50 })
  
  return { runs }
})
```

### Example 2: WebSocket Stream

**Before (OLD):**
```typescript
// api/_flows/ws.ts
import { useEventStore } from '#imports'

const store = useEventStore()
const unsub = store.subscribe(flowStream, (event) => {
  peer.send({ type: 'event', event })
})
```

**After (NEW):**
```typescript
// api/_flows/ws.ts
import { useStreamAdapter } from '#imports'

const stream = useStreamAdapter()
const handle = await stream.subscribe(`store:append:${flowStream}`, (streamEvent) => {
  peer.send({ type: 'event', event: streamEvent.data.event })
})
```

### Example 3: Start Flow

**Before (OLD):**
```typescript
import { useQueue, useEventManager } from '#imports'

const queue = useQueue()  // Uses QueueProvider (BullMQ)
const events = useEventManager()

const flowId = randomUUID()
await queue.enqueue(queueName, { name: step, data: { flowId, flowName } })
await events.publishBus({ type: 'flow.start', runId: flowId })
```

**After (NEW):**
```typescript
import { useQueueAdapter, useEventManager } from '#imports'

const queue = useQueueAdapter()  // Uses new QueueAdapter
const events = useEventManager() // Unchanged (in-process EventBus)

const flowId = randomUUID()
await queue.enqueue(queueName, { name: step, data: { flowId, flowName } })
await events.publishBus({ type: 'flow.start', runId: flowId })
```

## Backward Compatibility

All OLD utilities remain functional during migration:

- ✅ `useEventStore()` - Still works, wraps EventStoreAdapter
- ✅ `useQueue()` - Still works, wraps QueueProvider
- ✅ `useEventManager()` - Still works, unchanged
- ✅ `useFlowEngine()` - Still works, uses OLD system

New utilities can be adopted gradually:

- 🆕 `useQueueAdapter()` - NEW, uses QueueAdapter
- 🆕 `useStreamAdapter()` - NEW, uses StreamAdapter
- 🆕 `useStoreAdapter()` - NEW, uses StoreAdapter

## Testing Strategy

1. **Unit Tests**: Test new adapters in isolation
2. **Integration Tests**: Test adapter factory and wiring
3. **API Tests**: Test endpoints with new adapters
4. **E2E Tests**: Test full flow with new architecture

## Rollout Plan

### Week 1: Foundation ✅
- [x] Implement new adapter interfaces
- [x] Create built-in adapters (Memory, File)
- [x] Create adapter factory
- [x] Add StreamAdapter integration to StoreAdapter

### Week 2: Utilities
- [ ] Create `useAdapters.ts` utilities
- [ ] Update `useQueue()` to optionally use QueueAdapter
- [ ] Update `useFlowEngine()` to use new adapters
- [ ] Add deprecation notices to OLD utils

### Week 3: APIs
- [ ] Migrate flow APIs to use StoreAdapter
- [ ] Update WebSocket to use StreamAdapter
- [ ] Migrate queue APIs to use QueueAdapter
- [ ] Test all endpoints

### Week 4: Cleanup
- [ ] Remove OLD EventStoreAdapter system
- [ ] Remove deprecated utils
- [ ] Update documentation
- [ ] Update playground examples

## Current Status

**Completed:**
- ✅ New adapter interfaces (QueueAdapter, StreamAdapter, StoreAdapter)
- ✅ Built-in adapters (Memory, File)
- ✅ Adapter factory with dependency injection
- ✅ StreamAdapter integration in StoreAdapter
- ✅ New utility wrappers created

**Next Steps:**
- 🔄 Create plugin to initialize adapters
- 🔄 Update existing utils to support both OLD and NEW
- 🔄 Migrate WebSocket handler to StreamAdapter
- 🔄 Test in playground

**Future:**
- ⏳ Create Redis adapters (Queue, Stream, Store)
- ⏳ Migrate all APIs to new adapters
- ⏳ Remove OLD system
- ⏳ Release v0.5

---

**Branch**: monorepo-refactoring  
**Date**: 2025-11-08  
**Status**: Phase 1 Complete, Phase 2 In Progress
