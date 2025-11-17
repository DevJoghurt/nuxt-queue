# Store + Stream Adapter Integration

## Overview

**NEW ARCHITECTURE (v0.4.1 Refined)**: Wiring layer coordinates streaming, not StoreAdapter.

StoreAdapter is pure storage. StreamAdapter is pure pub/sub. The **Wiring Layer** (StreamCoordinator) connects them via the event bus.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Application Code                        │
│  (FlowWiring, Workers, API Endpoints)                       │
└────────────────────┬────────────────────────────────────────┘
                     │ calls append/save/delete
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                   StoreAdapter                              │
│  (Pure storage - NO streaming logic)                       │
│  - append() → writes to disk/memory                        │
│  - save() → stores document                                │
│  - delete() → removes document                             │
│  - kv.set() → sets key-value                               │
└────────────────────┬────────────────────────────────────────┘
                     │ publishes to
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                      Event Bus                              │
│  (In-process pub/sub for coordination)                     │
└────────────────────┬────────────────────────────────────────┘
                     │ wiring subscribes
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                StreamCoordinator (Wiring)                   │
│  - Subscribes to event bus                                 │
│  - Decides which events need streaming                     │
│  - Publishes to appropriate channels                       │
└────────────────────┬────────────────────────────────────────┘
                     │ publishes to 3 channels
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                  StreamAdapter                              │
│  1. store-sync channel (cache invalidation)                │
│  2. flow-events channel (orchestration)                    │
│  3. client-messages channel (UI updates)                   │
└────────────────────┬────────────────────────────────────────┘
                     │ replicates to
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              All Other Instances                            │
│  (Subscribe to StreamAdapter for cross-instance updates)   │
└─────────────────────────────────────────────────────────────┘
```

## Benefits of Wiring-Based Streaming

### 1. Clean Separation of Concerns
- **StoreAdapter**: Only storage logic, no streaming
- **StreamAdapter**: Only pub/sub, no storage
- **Wiring Layer**: Coordination and routing logic

### 2. Extensibility
- Easy to add new channels (triggers, webhooks, notifications)
- Easy to add new wiring (trigger system, webhook handler)
- No changes to adapters needed

### 3. Flexibility
- Configure channels per deployment
- Enable/disable channels without touching adapters
- Different channel configurations for dev/prod

### 4. Maintainability
- All routing logic in one place
- Easy to understand event flow
- Easy to debug streaming issues

## Implementation

### Three Stream Channels

The StreamCoordinator manages three distinct channels:

#### 1. **store-sync** - Cross-instance data replication
- **Purpose**: Cache invalidation and data consistency
- **Topics**: `store-sync:append:{subject}`
- **When**: After events are persisted to storage
- **Use case**: Multi-instance deployments

#### 2. **flow-events** - Flow orchestration
- **Purpose**: Coordinate flow execution across instances
- **Topics**: `flow:event:{runId}`, `flow:trigger:{flowName}`
- **When**: Important lifecycle events (start, complete, fail, emit)
- **Use case**: Distributed flow coordination

#### 3. **client-messages** - Client communication
- **Purpose**: Real-time UI updates via WebSocket/SSE
- **Topics**: `client:flow:{runId}`, `client:ui:*`
- **When**: All flow events that clients should see
- **Use case**: Live dashboards and monitoring

### StreamCoordinator Wiring

The StreamCoordinator subscribes to the event bus and publishes to StreamAdapter:

```typescript
// packages/nvent/src/runtime/events/wiring/streamCoordinator.ts
export function createStreamCoordinator(opts: StreamCoordinatorOptions = {}) {
  const bus = getEventBus()
  const stream = useStreamAdapter()
  
  function start() {
    // Channel 1: store-sync (cache invalidation)
    bus.onType('flow.start', async (e) => {
      if (!e.id || !e.ts) return // Only published events
      
      await stream.publish(`store-sync:append:${subject}`, {
        type: 'store.append',
        data: { subject, event: e },
        timestamp: Date.now(),
      })
    })
    
    // Channel 2: flow-events (orchestration)
    bus.onType('flow.completed', async (e) => {
      await stream.publish(`flow:event:${e.runId}`, {
        type: 'flow.completed',
        data: { runId: e.runId, event: e },
      })
    })
    
    // Channel 3: client-messages (UI updates)
    if (opts.enableClientMessages) {
      bus.onType('*', async (e) => {
        await stream.publish(`client:flow:${e.runId}`, {
          type: 'flow.event',
          data: { event: e },
        })
      })
    }
  }
  
  return { start, stop }
}
```

### Wiring Registry

The wiring registry initializes all wirings including the stream coordinator:

```typescript
// packages/nvent/src/runtime/events/wiring/registry.ts
export function createWiringRegistry(opts?: WiringRegistryOptions) {
  const wirings = [
    createFlowWiring(),           // Flow orchestration
    createStreamCoordinator(opts), // Stream publishing
    // Future: createTriggerWiring(), createWebhookWiring()
  ]
  
  return {
    start() {
      wirings.forEach(w => w.start())
    },
    stop() {
      wirings.forEach(w => w.stop())
    },
  }
}
```

## Configuration

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['nvent'],
  
  nvent: {
    queue: { adapter: 'file' },
    stream: { adapter: 'memory' }, // or 'redis' for multi-instance
    store: { adapter: 'file' },
    
    // Optional: Configure stream channels
    wiring: {
      streamCoordinator: {
        enableStoreSync: true,        // Cache invalidation
        enableFlowEvents: true,        // Flow coordination
        enableClientMessages: false,   // WebSocket (opt-in)
      }
    }
  }
})
```

## Usage Example

```typescript
// Application code just uses StoreAdapter
const store = useStoreAdapter()

await store.append('nq:flow:abc-123', {
  type: 'step.completed',
  data: { result: 42 },
})

// StreamCoordinator automatically publishes to:
// - store-sync:append:nq:flow:abc-123 (for cache invalidation)
// - flow:event:abc-123 (for orchestration)
// - client:flow:abc-123 (if enabled, for UI)

// Other instances subscribe to channels
const stream = useStreamAdapter()

await stream.subscribe('store-sync:append:*', async (event) => {
  console.log('Remote store update:', event)
  // Invalidate local cache
})

await stream.subscribe('flow:event:*', async (event) => {
  console.log('Flow event:', event)
  // Coordinate flow execution
})
```

## Usage Example

```typescript
import { createAdapters } from './adapters/factory'

// Create adapters with Redis streaming
const adapters = await createAdapters({
  stream: { type: 'redis', options: { host: 'localhost' } },
  store: { type: 'redis', options: { host: 'localhost' } },
  queue: { type: 'redis', options: { host: 'localhost' } },
})

// Store operations automatically stream to all instances
await adapters.store.append('nq:flow:abc-123', {
  type: 'step.completed',
  data: { result: 42 },
})
// ✅ Published to StreamAdapter automatically
// ✅ All instances receive update via stream.subscribe()

// Other instances subscribe to topics
await adapters.stream.subscribe('store:append:*', async (event) => {
  console.log('Remote store update:', event)
  // Apply update locally
})
```

## Next Steps

1. ✅ **DONE**: Remove StreamAdapter from StoreAdapter
2. ✅ **DONE**: Create StreamCoordinator wiring
3. ✅ **DONE**: Update adapter factory (no dependencies)
4. ⏳ **TODO**: Create Redis adapters with StreamAdapter integration
5. ⏳ **TODO**: Update WebSocket handler to subscribe via StreamAdapter channels
6. ⏳ **TODO**: Add wiring configuration options to module config
7. ⏳ **TODO**: Implement trigger wiring (when trigger system is ready)

## Compatibility

- **Memory adapters**: Single instance, no cross-instance streaming needed
- **File adapters**: Single instance, no cross-instance streaming needed
- **Redis adapters**: Multi-instance, stream channels enable coordination
- **Configuration**: Channels can be enabled/disabled per deployment
- **Migration**: Existing code works unchanged (wiring layer is transparent)

## Testing

### Single Instance (File/Memory)
```typescript
const adapters = await createAdapters({
  store: { adapter: 'file', file: { dataDir: '.data' } },
  stream: { adapter: 'memory' },
  queue: { adapter: 'file', file: { dataDir: '.data' } },
})

// StreamCoordinator runs but memory adapter is single-instance only
// No cross-instance streaming, but architecture is consistent
```

### Multi-Instance (Redis with channels)
```typescript
const adapters = await createAdapters({
  store: { adapter: 'redis', redis: { host: 'localhost' } },
  stream: { adapter: 'redis', redis: { host: 'localhost' } },
  queue: { adapter: 'redis', redis: { host: 'localhost' } },
})

// StreamCoordinator publishes to Redis channels
// All instances receive updates via subscriptions
```

---

**Status**: ✅ Core refactoring complete  
**Branch**: monorepo-refactoring  
**Date**: 2025-11-13

## Key Architectural Improvements

### Before (Option A - Coupled)
```
StoreAdapter ──directly publishes to──> StreamAdapter
```
- Every store adapter needs streaming logic
- Tight coupling between storage and messaging
- Hard to extend with new channels

### After (Wiring Layer - Decoupled)
```
StoreAdapter ──publishes to──> EventBus
                                  │
                            subscribes │
                                  ▼
                        StreamCoordinator ──routes to──> StreamAdapter
                                                           (3 channels)
```
- StoreAdapter is pure storage
- StreamCoordinator handles all routing
- Easy to add channels (triggers, webhooks, notifications)
- Clear separation of concerns
