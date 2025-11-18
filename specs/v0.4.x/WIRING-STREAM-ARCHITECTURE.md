# Wiring-Based Stream Architecture

**Version:** v0.4.1 Refined  
**Date:** 2025-11-13  
**Status:** ✅ Implemented

## Overview

This document describes the refactored architecture where the **Wiring Layer** (StreamCoordinator) handles all StreamAdapter publishing, not the StoreAdapter.

## Problem with Previous Approach

**Option A (Initial v0.4.1)**: StoreAdapter directly publishes to StreamAdapter
```
StoreAdapter ──has dependency on──> StreamAdapter
```

**Issues:**
- Every store adapter needs streaming logic
- Tight coupling between storage and messaging
- Hard to extend with new channels (triggers, webhooks, etc.)
- StoreAdapter does two jobs: storage + messaging

## New Clean Architecture

**Wiring Layer Pattern**: StreamCoordinator subscribes to event bus and routes to StreamAdapter
```
StoreAdapter ──publishes to──> EventBus
                                 │
                          subscribes │
                                 ▼
                       StreamCoordinator ──routes to──> StreamAdapter
                                                          (3 channels)
```

**Benefits:**
- StoreAdapter is pure storage (single responsibility)
- All routing logic in one place (wiring layer)
- Easy to add new channels
- Easy to enable/disable channels per deployment
- Clean separation of concerns

## Three Stream Channels

### 1. `store-sync:*` - Cross-instance data replication

**Purpose:** Cache invalidation and data consistency  
**Topics:** `store-sync:append:{subject}`  
**When:** After events are persisted to storage  
**Use case:** Multi-instance deployments with shared cache

**Example:**
```typescript
// Published by StreamCoordinator
await stream.publish('store-sync:append:nq:flow:abc-123', {
  type: 'store.append',
  data: {
    subject: 'nq:flow:abc-123',
    event: { id: '123-456', type: 'step.completed', ... }
  },
  timestamp: Date.now()
})

// Subscribed by cache invalidation logic
await stream.subscribe('store-sync:append:*', async (event) => {
  const subject = event.data.subject
  cache.invalidate(subject)
})
```

### 2. `flow:*` - Flow orchestration

**Purpose:** Coordinate flow execution across instances  
**Topics:** `flow:event:{runId}`, `flow:trigger:{flowName}`  
**When:** Important lifecycle events (start, complete, fail, emit)  
**Use case:** Distributed flow coordination, trigger system

**Example:**
```typescript
// Published by StreamCoordinator
await stream.publish('flow:event:abc-123', {
  type: 'flow.completed',
  data: {
    runId: 'abc-123',
    flowName: 'process-order',
    event: { ... }
  },
  timestamp: Date.now()
})

// Subscribed by trigger system (future)
await stream.subscribe('flow:event:*', async (event) => {
  if (event.type === 'flow.completed') {
    // Check if this should trigger another flow
    await checkTriggers(event.data.flowName, event)
  }
})
```

### 3. `client:*` - Client communication

**Purpose:** Real-time UI updates via WebSocket/SSE  
**Topics:** `client:flow:{runId}`, `client:ui:*`  
**When:** All flow events that clients should see  
**Use case:** Live dashboards, monitoring UI

**Example:**
```typescript
// Published by StreamCoordinator (when enabled)
await stream.publish('client:flow:abc-123', {
  type: 'flow.event',
  data: {
    event: { type: 'step.completed', ... }
  },
  timestamp: Date.now()
})

// Subscribed by WebSocket handler
await stream.subscribe('client:flow:abc-123', async (event) => {
  // Send to connected WebSocket clients
  broadcastToClients(event)
})
```

## StreamCoordinator Implementation

**Location:** `packages/nvent/src/runtime/events/wiring/streamCoordinator.ts`

```typescript
export interface StreamCoordinatorOptions {
  enableStoreSync?: boolean        // Default: true
  enableFlowEvents?: boolean        // Default: true
  enableClientMessages?: boolean    // Default: false (opt-in)
}

export function createStreamCoordinator(opts: StreamCoordinatorOptions = {}) {
  const bus = getEventBus()
  const stream = useStreamAdapter()
  const unsubs: Array<() => void> = []

  function start() {
    // Channel 1: store-sync (cache invalidation)
    if (opts.enableStoreSync) {
      const handleStoreSyncAppend = async (e: EventRecord) => {
        if (!e.id || !e.ts) return // Only persisted events
        
        const subject = SubjectPatterns.flowRun(e.runId)
        await stream.publish(`store-sync:append:${subject}`, {
          type: 'store.append',
          data: { subject, event: e },
          timestamp: Date.now()
        })
      }
      
      // Subscribe to all persisted event types
      unsubs.push(bus.onType('flow.start', handleStoreSyncAppend))
      unsubs.push(bus.onType('step.completed', handleStoreSyncAppend))
      // ... etc
    }
    
    // Channel 2: flow-events (orchestration)
    if (opts.enableFlowEvents) {
      const handleFlowEvent = async (e: EventRecord) => {
        if (!e.id || !e.ts) return
        
        await stream.publish(`flow:event:${e.runId}`, {
          type: e.type,
          data: { runId: e.runId, flowName: e.flowName, event: e },
          timestamp: Date.now()
        })
      }
      
      unsubs.push(bus.onType('flow.start', handleFlowEvent))
      unsubs.push(bus.onType('flow.completed', handleFlowEvent))
      unsubs.push(bus.onType('emit', handleFlowEvent))
      // ... etc
    }
    
    // Channel 3: client-messages (UI updates)
    if (opts.enableClientMessages) {
      const handleClientMessage = async (e: EventRecord) => {
        if (!e.id || !e.ts) return
        
        await stream.publish(`client:flow:${e.runId}`, {
          type: 'flow.event',
          data: { event: e },
          timestamp: Date.now()
        })
      }
      
      // Subscribe to all event types for clients
      unsubs.push(bus.onType('*', handleClientMessage))
    }
  }

  function stop() {
    unsubs.forEach(u => u())
    unsubs.length = 0
  }

  return { start, stop }
}
```

## Wiring Registry Integration

**Location:** `packages/nvent/src/runtime/events/wiring/registry.ts`

```typescript
export interface WiringRegistryOptions {
  streamCoordinator?: {
    enableStoreSync?: boolean
    enableFlowEvents?: boolean
    enableClientMessages?: boolean
  }
}

export function createWiringRegistry(opts?: WiringRegistryOptions): Wiring {
  const wirings: Wiring[] = [
    // 1. Flow orchestration (persistence, completion tracking)
    createFlowWiring(),
    
    // 2. Stream coordinator (publish to channels)
    createStreamCoordinator(opts?.streamCoordinator || {
      enableStoreSync: true,
      enableFlowEvents: true,
      enableClientMessages: false, // Opt-in
    }),
    
    // Future: createTriggerWiring(), createWebhookWiring()
  ]

  return {
    start() {
      wirings.forEach(w => w.start())
    },
    stop() {
      wirings.forEach(w => w.stop())
    }
  }
}
```

## Adapter Simplification

### StoreAdapter (No Streaming)

```typescript
// packages/nvent/src/runtime/adapters/builtin/memory-store.ts
export class MemoryStoreAdapter implements StoreAdapter {
  // NO streamAdapter field
  // NO stream publishing in methods
  
  async append(subject: string, event: EventRecord): Promise<EventRecord> {
    // Just storage
    const eventRecord = { id: generateId(), ts: Date.now(), ...event }
    this.eventStreams.get(subject)!.push(eventRecord)
    this.notifySubscribers(subject, eventRecord) // In-process only
    return eventRecord
  }
  
  async save(collection: string, id: string, doc: any): Promise<void> {
    // Just storage
    this.documents.get(collection)!.set(id, doc)
  }
  
  // ... other methods are pure storage
}
```

### Factory (No Dependencies)

```typescript
// packages/nvent/src/runtime/adapters/factory.ts
export async function createAdapters(config) {
  // All adapters are independent
  const stream = await createStreamAdapter(config.stream)
  const store = await createStoreAdapter(config.store) // No dependency!
  const queue = await createQueueAdapter(config.queue)

  return { queue, stream, store }
}
```

## Configuration Example

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['nvent'],
  
  nvent: {
    // Adapters (independent)
    queue: { adapter: 'file', file: { dataDir: '.data/queue' } },
    stream: { adapter: 'memory' }, // or 'redis' for multi-instance
    store: { adapter: 'file', file: { dataDir: '.data/store' } },
    
    // Wiring configuration (optional)
    wiring: {
      streamCoordinator: {
        enableStoreSync: true,        // Cache invalidation
        enableFlowEvents: true,        // Flow orchestration
        enableClientMessages: false,   // WebSocket (enable when needed)
      }
    }
  }
})
```

## Usage Examples

### Application Code (Unchanged)

```typescript
// Application code just uses StoreAdapter - no streaming concerns
const store = useStoreAdapter()

await store.append('nq:flow:abc-123', {
  type: 'step.completed',
  data: { result: 42 }
})

// StreamCoordinator automatically publishes to channels
// Application doesn't need to know about streaming
```

### Subscribing to Channels

```typescript
const stream = useStreamAdapter()

// Subscribe to store sync for cache invalidation
await stream.subscribe('store-sync:append:*', async (event) => {
  console.log('Remote update:', event.data.subject)
  cache.invalidate(event.data.subject)
})

// Subscribe to flow events for coordination
await stream.subscribe('flow:event:*', async (event) => {
  if (event.type === 'flow.completed') {
    console.log('Flow completed:', event.data.flowName)
  }
})

// Subscribe to client messages for WebSocket
await stream.subscribe('client:flow:abc-123', async (event) => {
  broadcastToClients(event.data.event)
})
```

## Benefits

### 1. Single Responsibility
- **StoreAdapter**: Only storage
- **StreamAdapter**: Only pub/sub
- **StreamCoordinator**: Only routing

### 2. Extensibility
Adding a new channel (e.g., `webhook:*`) only requires updating StreamCoordinator:

```typescript
// In StreamCoordinator
if (opts.enableWebhooks) {
  const handleWebhook = async (e: EventRecord) => {
    await stream.publish(`webhook:${e.flowName}`, {
      type: 'webhook.trigger',
      data: { event: e }
    })
  }
  
  unsubs.push(bus.onType('flow.completed', handleWebhook))
}
```

### 3. Configuration Flexibility
- Enable/disable channels per deployment
- Different channel configs for dev/prod
- Opt-in for expensive channels (client messages)

### 4. Clean Testing
- Test StoreAdapter without StreamAdapter
- Test StreamCoordinator with mock EventBus
- Test channels independently

## Migration from Old Approach

### Before (Option A)
```typescript
// StoreAdapter had StreamAdapter dependency
const store = new MemoryStoreAdapter({ streamAdapter: stream })

await store.append(subject, event)
// ❌ Store internally publishes to stream (tight coupling)
```

### After (Wiring Layer)
```typescript
// Adapters are independent
const store = new MemoryStoreAdapter()
const stream = new MemoryStreamAdapter()

// Wiring connects them via event bus
const wiring = createWiringRegistry({
  streamCoordinator: { enableStoreSync: true }
})
wiring.start()

await store.append(subject, event)
// ✅ Store publishes to EventBus
// ✅ StreamCoordinator publishes to StreamAdapter (decoupled)
```

## Future Enhancements

### 1. Trigger Wiring
```typescript
export function createTriggerWiring() {
  const bus = getEventBus()
  const stream = useStreamAdapter()
  
  function start() {
    // Subscribe to flow completion for trigger checks
    stream.subscribe('flow:event:*', async (event) => {
      if (event.type === 'flow.completed') {
        await checkAndFireTriggers(event.data.flowName)
      }
    })
  }
  
  return { start, stop }
}
```

### 2. Webhook Wiring
```typescript
export function createWebhookWiring() {
  const bus = getEventBus()
  const stream = useStreamAdapter()
  
  function start() {
    // Publish webhook events
    bus.onType('flow.completed', async (e) => {
      await stream.publish(`webhook:${e.flowName}`, {
        type: 'webhook.trigger',
        data: { event: e }
      })
    })
  }
  
  return { start, stop }
}
```

## Summary

### Key Insight
**Wiring is the right place for streaming logic**:
- Wiring already handles routing and coordination
- StoreAdapter stays simple (single responsibility)
- Easy to extend with new channels and wirings
- Clean architecture with clear boundaries

### Architecture
```
┌───────────────────────────────────────────────────────────┐
│                  Application Code                         │
└───────────────────────┬───────────────────────────────────┘
                        │ uses
        ┌───────────────┴────────────────┐
        ▼                                 ▼
┌─────────────┐                   ┌─────────────┐
│ StoreAdapter│                   │QueueAdapter │
│ (storage)   │                   │(job queues) │
└──────┬──────┘                   └─────────────┘
       │ publishes
       ▼
┌─────────────────────────────────────────────────────────┐
│                      EventBus                            │
│              (in-process coordination)                   │
└──────────────────────┬──────────────────────────────────┘
                       │ subscribes
                       ▼
         ┌─────────────────────────┐
         │   StreamCoordinator     │
         │      (Wiring Layer)     │
         │  - Routes to channels   │
         └──────────────┬──────────┘
                        │ publishes
                        ▼
         ┌─────────────────────────┐
         │    StreamAdapter        │
         │  (cross-instance pub/sub)│
         │  1. store-sync:*        │
         │  2. flow:*              │
         │  3. client:*            │
         └─────────────────────────┘
```

**Result:** Clean, maintainable, extensible architecture where every component has a single, well-defined responsibility.
