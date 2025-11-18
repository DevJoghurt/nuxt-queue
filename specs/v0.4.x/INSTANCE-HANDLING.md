# Cross-Instance Event Handling

**Version:** v0.4.1  
**Date:** 2025-11-13  
**Status:** ✅ Implemented

## Problem Statement

In a multi-instance deployment, when Instance A processes a flow:
1. Events are published to the event bus (Instance A only)
2. Events are persisted to storage via StoreAdapter
3. StreamCoordinator publishes to StreamAdapter channels
4. Other instances (B, C, D) receive events via StreamAdapter

**Risk**: Without proper handling, Instance B might:
- Re-process the same events (duplicate processing)
- Trigger steps that were already triggered on Instance A
- Create duplicate storage entries
- Waste resources and cause inconsistencies

## Solution: Instance ID Tagging

Every server instance generates a unique `INSTANCE_ID` on startup:

```typescript
// Generated once per instance
const INSTANCE_ID = `instance-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
```

This ID is included in all StreamAdapter messages to identify the origin.

## Architecture

### Event Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     Instance A                              │
│                                                             │
│  Worker processes job                                       │
│     │                                                       │
│     ▼                                                       │
│  EventBus.publish() ────────► FlowWiring                   │
│     │                             │                         │
│     │                             ▼                         │
│     │                        StoreAdapter.append()          │
│     │                        (persists to storage)          │
│     │                                                       │
│     ▼                                                       │
│  StreamCoordinator                                          │
│     │                                                       │
│     ▼                                                       │
│  StreamAdapter.publish('store-sync:*', {                   │
│    instanceId: 'instance-123-abc'  ◄─── Tagged with ID    │
│  })                                                         │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  │ Redis Pub/Sub (multi-instance)
                  │
        ┌─────────┴─────────┬─────────────────┐
        ▼                   ▼                  ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│  Instance A   │  │  Instance B   │  │  Instance C   │
│               │  │               │  │               │
│  ✅ Ignores   │  │  ✅ Processes │  │  ✅ Processes │
│  (same ID)    │  │  (diff ID)    │  │  (diff ID)    │
└───────────────┘  └───────────────┘  └───────────────┘
```

### Channel-Specific Handling

#### 1. `store-sync:*` Channel - Cache Invalidation

**Purpose**: Notify other instances about storage changes

**Instance Handling**: **Optional filtering** (currently not filtering)
- All instances receive the message (including origin)
- Origin instance could ignore (already has data in memory)
- Other instances invalidate cache or update local memory

**Current Implementation**:
```typescript
await stream.publish(`store-sync:append:${subject}`, {
  type: 'store.append',
  data: {
    subject,
    event: { ... },
    instanceId: INSTANCE_ID, // Tagged but not filtered
  },
  timestamp: Date.now(),
})
```

**Why no duplicate processing risk**:
- This is purely for **cache invalidation**, not event processing
- FlowWiring only processes events from the **event bus**, not from StreamAdapter
- StreamAdapter messages don't trigger workflow logic

#### 2. `flow:*` Channel - Flow Orchestration

**Purpose**: Coordinate flow execution and triggers across instances

**Instance Handling**: **Must be filtered** when implementing trigger system

**Example Use Case** (Future):
```typescript
// Trigger system subscribes to flow completions
await stream.subscribe('flow:event:*', async (message) => {
  // Check if this is from another instance
  if (message.data.instanceId === INSTANCE_ID) {
    return // Skip - already processed locally
  }
  
  // Process trigger logic for remote flow completion
  await checkAndFireTriggers(message.data.flowName)
})
```

**Current State**: Not yet used (no subscribers), prepared for trigger system

#### 3. `client:*` Channel - WebSocket Updates

**Purpose**: Real-time UI updates to all connected clients

**Instance Handling**: **No filtering needed**
- All instances broadcast to their connected WebSocket clients
- Each instance serves different clients
- Clients need updates regardless of which instance processed the event

**Current Implementation**:
```typescript
// WebSocket subscribes to client channel
await stream.subscribe(`client:flow:${runId}`, async (message) => {
  // No instance filtering - all instances send to their clients
  const event = message.data?.event
  safeSend(peer, {
    type: 'event',
    flowName,
    runId,
    event: {
      v: 1,
      eventType: event.type,
      record: event,
    },
  })
})
```

## Key Insight: Event Bus is Single Source of Truth

**Critical Design Principle**:
> **Only the event bus triggers workflow processing**  
> StreamAdapter messages are **read-only notifications**, never trigger actions

### Flow Processing Architecture

```
┌──────────────────────────────────────────────────────────┐
│           SINGLE SOURCE OF TRUTH                         │
│                                                          │
│              EventBus (In-Process)                       │
│                                                          │
│  ✅ FlowWiring subscribes here                          │
│  ✅ Triggers step execution                             │
│  ✅ Updates metadata                                    │
│  ✅ Analyzes completion                                 │
└────────────────┬─────────────────────────────────────────┘
                 │
                 │ Only publishes, never subscribes
                 ▼
┌──────────────────────────────────────────────────────────┐
│          StreamAdapter (Cross-Instance)                  │
│                                                          │
│  ❌ FlowWiring does NOT subscribe here                  │
│  ✅ Used only for:                                      │
│     - Cache invalidation (store-sync)                   │
│     - Trigger coordination (future)                     │
│     - Client notifications (WebSocket)                  │
└──────────────────────────────────────────────────────────┘
```

### Why No Duplicate Processing

1. **Worker executes job** → publishes to **event bus** (Instance A only)
2. **FlowWiring** subscribes to **event bus** → processes locally (Instance A only)
3. **StoreAdapter** persists to storage (visible to all instances)
4. **StreamCoordinator** publishes to **StreamAdapter** (notification only)
5. **Other instances** receive StreamAdapter message but:
   - FlowWiring does **NOT** subscribe to StreamAdapter
   - FlowWiring only processes **event bus** events
   - No duplicate workflow logic execution

## Configuration

### Enable Client Messages for WebSocket

```typescript
// packages/nvent/src/runtime/server/plugins/00.adapters.ts
const wiring = createWiringRegistry({
  streamCoordinator: {
    enableStoreSync: true,        // Cache invalidation
    enableFlowEvents: true,        // Future trigger system
    enableClientMessages: true,    // WebSocket support ← Must enable
  },
})
```

### WebSocket Subscribes to Client Channel

```typescript
// packages/nvent/src/runtime/server/api/_flows/ws.ts

// Subscribe to client:flow:{runId} channel for real-time updates
const topic = `client:flow:${runId}`
const handle = await stream.subscribe(topic, async (message: any) => {
  const event = message.data?.event
  
  // Send to WebSocket client (no filtering needed)
  safeSend(peer, {
    type: 'event',
    flowName,
    runId,
    event: {
      v: 1,
      eventType: event.type,
      record: event,
    },
  })
})
```

## Testing Cross-Instance Behavior

### Single Instance

```typescript
// Memory adapters - no cross-instance communication
const adapters = await createAdapters({
  queue: { adapter: 'memory' },
  stream: { adapter: 'memory' },
  store: { adapter: 'memory' },
})

// ✅ Works fine
// ✅ No instance ID needed (no other instances)
// ✅ EventBus handles everything locally
```

### Multi-Instance (Redis)

```bash
# Terminal 1 - Instance A
INSTANCE_ID=instance-A npm run dev

# Terminal 2 - Instance B  
INSTANCE_ID=instance-B npm run dev
```

**What Happens**:
1. Client sends job to Instance A
2. Instance A processes job → event bus → FlowWiring → StoreAdapter
3. Instance A's StreamCoordinator publishes to Redis:
   - `store-sync:append:nq:flow:123` with `instanceId: 'instance-A'`
   - `client:flow:123` with `instanceId: 'instance-A'`
4. Instance B receives messages via Redis Pub/Sub:
   - `store-sync`: Could filter but doesn't need to (just cache notification)
   - `client:flow`: Broadcasts to its WebSocket clients (no filtering)
5. Instance B's FlowWiring does **NOT** process these events (not on event bus)

**Result**: ✅ No duplicate processing, only cache sync and client notifications

## Future: Trigger System with Instance Filtering

When the trigger system is implemented, it will need instance filtering:

```typescript
// Future: packages/nvent/src/runtime/events/wiring/triggerWiring.ts

export function createTriggerWiring() {
  const stream = useStreamAdapter()
  const INSTANCE_ID = getCurrentInstanceId()
  
  function start() {
    // Subscribe to flow completion events for trigger checks
    stream.subscribe('flow:event:*', async (message) => {
      // IMPORTANT: Filter out own events to prevent duplicate triggers
      if (message.data.instanceId === INSTANCE_ID) {
        return // Already processed locally
      }
      
      // This flow completed on another instance
      // Check if it should trigger other flows
      const flowName = message.data.flowName
      if (message.type === 'flow.completed') {
        await checkAndFireTriggers(flowName, message.data.event)
      }
    })
  }
  
  return { start, stop }
}
```

**Why filtering matters here**:
- Trigger checks can be expensive (DB queries)
- Want to check triggers only once across all instances
- Instance that processed the flow already checked triggers locally
- Other instances should skip to avoid duplicate work

## Summary

### Current State (v0.4.1)

✅ **Instance ID tagging** implemented  
✅ **EventBus is single source of truth** for workflow processing  
✅ **StreamAdapter is read-only** for notifications  
✅ **No duplicate processing** risk  
✅ **WebSocket updates** work across all instances  
❌ **Filtering not needed yet** (no trigger system)

### Future Work

When implementing trigger system:
- Add instance ID filtering in trigger wiring
- Ensure triggers fire only once across all instances
- Use `flow:event:*` channel for coordination

### Key Principles

1. **Event Bus = Processing**: Workflow logic only triggered by event bus
2. **StreamAdapter = Notification**: Cross-instance read-only messages
3. **Instance ID = Origin**: Tag messages to identify source
4. **Filter When Needed**: Apply filtering for expensive operations (triggers)
5. **Broadcast When Needed**: No filtering for fan-out (WebSocket, cache sync)

**Result**: Clean, efficient, duplicate-free multi-instance architecture! 🎉
