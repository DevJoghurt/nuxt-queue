# Distributed Event Coordination Specification

**Version:** 0.6.0  
**Status:** Draft  
**Date:** 2025-11-27

## Overview

This specification defines how to enable horizontal scaling of the nvent flow orchestration system by replacing the in-memory event bus with distributed event coordination using the StreamAdapter.

## Current State Analysis

### What Works Today (Single Instance / Sticky Sessions)

```
┌─────────────────────────────────────────────────────┐
│ Instance A                                          │
├─────────────────────────────────────────────────────┤
│                                                     │
│  1. Worker completes step                          │
│  2. Publishes to LOCAL event bus                   │
│  3. flowWiring handlers process event:             │
│     - handlePersistence: Appends to stream         │
│     - handleOrchestration: Checks dependencies     │
│       • Uses pendingEmitTracking Map (in-memory)   │
│       • Calls checkAndTriggerPendingSteps()        │
│       • Enqueues next steps to BullMQ              │
│     - handleFlowStats: Updates counters            │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Critical In-Memory State:**
1. `pendingEmitTracking` Map - Coordinates emit tracking with orchestration
2. `publishingTerminalEvents` Set - Prevents duplicate terminal events
3. Event bus subscriptions - Routes events to handlers

### What Breaks in Multi-Instance (Without Sticky Sessions)

```
┌──────────────────────┐         ┌──────────────────────┐
│ Instance A           │         │ Instance B           │
├──────────────────────┤         ├──────────────────────┤
│                      │         │                      │
│ Worker completes     │         │ (Doesn't know about  │
│ step in flow X       │         │  flow X events)      │
│                      │         │                      │
│ emit event tracked   │         │ emit event NOT in    │
│ in local Map         │         │ local Map            │
│                      │         │                      │
│ Orchestration reads  │         │ If route changes:    │
│ from local Map ✓     │         │ Orchestration reads  │
│                      │         │ empty Map ✗          │
│                      │         │                      │
└──────────────────────┘         └──────────────────────┘
```

**Problems:**
- `pendingEmitTracking` Map not shared across instances
- Race condition: Instance B orchestrates before Instance A's emit tracking completes
- Duplicate orchestration: Both instances might process same event
- Split brain: Different instances have different views of flow state

## Goals

### Functional Requirements

1. **FR-1: Cross-Instance Event Visibility**
   - All instances MUST receive flow orchestration events
   - Events MUST be delivered in order per flow run
   - Events MUST NOT be lost during instance failures

2. **FR-2: Single Orchestrator Guarantee**
   - Only ONE instance MUST perform orchestration per flow event
   - Orchestration MUST complete even if the orchestrating instance fails
   - No duplicate step enqueueing

3. **FR-3: Emit Tracking Coordination**
   - Orchestration MUST wait for emit tracking to complete
   - Emit tracking status MUST be visible across instances
   - No race conditions between emit tracking and orchestration

4. **FR-4: Terminal Event Deduplication**
   - Only ONE terminal event (flow.completed/failed) MUST be published per flow
   - Terminal events MUST be idempotent across instances

5. **FR-5: Backward Compatibility**
   - Single instance deployments MUST work without performance regression
   - Migration path MUST be transparent (no config changes required)

### Non-Functional Requirements

1. **NFR-1: Performance**
   - Orchestration latency: < 100ms overhead vs single instance
   - Lock contention: Minimal (per-runId locks, not global)
   - Network overhead: Single StreamAdapter message per event

2. **NFR-2: Reliability**
   - Lock expiry: Automatic cleanup after 10 seconds
   - Crash recovery: No orphaned locks prevent flow progress
   - Retry safety: All operations idempotent

3. **NFR-3: Scalability**
   - Support 10+ instances per deployment
   - No single point of failure (any instance can orchestrate)
   - Graceful degradation under lock contention

4. **NFR-4: Observability**
   - Log which instance handles orchestration per event
   - Track lock acquisition success/failure rates
   - Monitor orchestration latency per instance

## Design Principles

### 1. Separate Concerns: Broadcast vs Orchestration

**Current (Mixed):**
```typescript
// Local event bus does BOTH:
bus.publish(event) // 1. Broadcast to handlers
// Handlers immediately orchestrate
```

**Proposed (Separated):**
```typescript
// StreamAdapter: Broadcast to all instances
stream.publish('nq:internal:events', event)

// Each instance: Compete for orchestration lock
const lockAcquired = await acquireLock(runId)
if (lockAcquired) {
  await orchestrate(event)
}
```

### 2. Distributed State: Redis as Source of Truth

**In-Memory State → Redis State Mapping:**

| Current In-Memory | Distributed Equivalent | Scope | TTL |
|-------------------|------------------------|-------|-----|
| `pendingEmitTracking` Map | Redis Hash: `nq:emit-tracking:{runId}` | Per runId | 60s |
| `publishingTerminalEvents` Set | Redis Key: `nq:terminal-lock:{runId}` | Per runId | 10s |
| Event bus handlers | StreamAdapter subscription | Global | N/A |
| Orchestration exclusivity | Redis Lock: `nq:orch-lock:{runId}` | Per runId | 10s |

### 3. Lock Granularity: Per-RunId, Not Global

**Why per-runId locks?**
- ✅ Different flows don't block each other
- ✅ Parallelism: N flows = N concurrent orchestrations
- ✅ Failure isolation: Lock expiry only affects one flow
- ❌ NOT global lock (would serialize all flows)

### 4. Fail-Safe Defaults: Locks Auto-Expire

**Lock Lifecycle:**
```
1. acquire(key, instanceId, ex=10) → OK or FAIL
2. If OK: Perform orchestration (typically 10-100ms)
3. Release lock: del(key)
4. If crash: Lock expires after 10s, another instance can retry
```

**Edge Cases:**
- Instance crashes during orchestration → Lock expires → Another instance retries
- Slow orchestration (>10s) → Lock expires → Duplicate orchestration possible
- Solution: Idempotent operations (BullMQ job IDs prevent duplicate enqueue)

## Detailed Design

### Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│ Redis (StreamAdapter Backend)                                    │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│ nq:internal:events (Stream)                                      │
│ ├─ flow.start, step.completed, emit, etc.                       │
│ └─ Consumed by all instances                                     │
│                                                                  │
│ nq:orch-lock:{runId} (String, ex=10s)                           │
│ └─ Orchestration exclusivity per flow run                       │
│                                                                  │
│ nq:emit-tracking:{runId} (Hash)                                  │
│ ├─ {stepName}:pending = timestamp                               │
│ ├─ {stepName}:complete = timestamp                              │
│ └─ TTL: 60s after last update                                   │
│                                                                  │
│ nq:terminal-lock:{runId} (String, ex=10s)                       │
│ └─ Ensures single terminal event publication                    │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
         ▲                    ▲                    ▲
         │                    │                    │
         │                    │                    │
┌────────┴────────┐  ┌────────┴────────┐  ┌────────┴────────┐
│ Instance A      │  │ Instance B      │  │ Instance C      │
├─────────────────┤  ├─────────────────┤  ├─────────────────┤
│                 │  │                 │  │                 │
│ StreamAdapter   │  │ StreamAdapter   │  │ StreamAdapter   │
│ Subscriber      │  │ Subscriber      │  │ Subscriber      │
│                 │  │                 │  │                 │
│ flowWiring      │  │ flowWiring      │  │ flowWiring      │
│ - Persistence   │  │ - Persistence   │  │ - Persistence   │
│ - Orchestration │  │ - Orchestration │  │ - Orchestration │
│ - Stats         │  │ - Stats         │  │ - Stats         │
│                 │  │                 │  │                 │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### Event Flow: Step Completion

```
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 1: Event Publication (Any Instance)                       │
└─────────────────────────────────────────────────────────────────┘

Instance A (Worker completes step):
  1. worker.completed(jobId, result)
  2. Publish to StreamAdapter: stream.publish('nq:internal:events', {
       type: 'step.completed',
       runId: 'run-123',
       flowName: 'approval',
       stepName: 'validate',
       ...
     })

┌─────────────────────────────────────────────────────────────────┐
│ PHASE 2: Event Reception (All Instances)                        │
└─────────────────────────────────────────────────────────────────┘

Instance A, B, C (All receive via StreamAdapter):
  stream.onMessage('nq:internal:events', async (event) => {
    await handlePersistence(event)   // All instances persist
    await handleOrchestration(event) // Only one orchestrates (lock)
    await handleFlowStats(event)     // All instances update stats
  })

┌─────────────────────────────────────────────────────────────────┐
│ PHASE 3: Persistence (All Instances, Idempotent)                │
└─────────────────────────────────────────────────────────────────┘

handlePersistence(event):
  1. Append event to stream: nq:flow:run-123
  2. Redis XADD returns unique event ID
  3. All instances append → Redis deduplicates by ID
  4. Result: Single event in stream

┌─────────────────────────────────────────────────────────────────┐
│ PHASE 4: Orchestration (Single Instance via Lock)               │
└─────────────────────────────────────────────────────────────────┘

handleOrchestration(event):
  1. Try lock: SET nq:orch-lock:run-123 {instanceId} EX 10 NX
  
  Instance A: OK (acquired lock)
  Instance B: nil (lock held by A)
  Instance C: nil (lock held by A)
  
  Instance A continues:
    2. Check emit tracking status in Redis:
       HGET nq:emit-tracking:run-123 validate:complete
       → If pending, wait
    
    3. Perform orchestration:
       - checkAndTriggerPendingSteps(flowName, runId, store)
       - Enqueue next steps (BullMQ with jobId for idempotency)
    
    4. Release lock: DEL nq:orch-lock:run-123
  
  Instance B & C: Return early (lock not acquired)

┌─────────────────────────────────────────────────────────────────┐
│ PHASE 5: Stats Update (All Instances, Last Write Wins)          │
└─────────────────────────────────────────────────────────────────┘

handleFlowStats(event):
  1. All instances update flow stats
  2. Redis atomic operations (HINCRBY)
  3. Last write wins for timestamps
  4. Eventually consistent across instances
```

### Emit Tracking Coordination

**Problem:** `pendingEmitTracking` Map is in-memory, not visible across instances.

**Solution:** Use Redis Hash to track emit tracking status.

#### Emit Event Processing

```typescript
// Instance A: Receives emit event
if (e.type === 'emit') {
  const eventName = e.data?.name
  const runId = e.runId
  
  // 1. Mark as pending in Redis
  await store.kv.hset(
    `nq:emit-tracking:${runId}`,
    `${eventName}:pending`,
    Date.now().toString()
  )
  
  // 2. Update metadata in store
  const trackingPromise = (async () => {
    try {
      await store.index.updateWithRetry(indexKey, runId, {
        emittedEvents: { /* nested object */ }
      })
      
      // 3. Mark as complete in Redis
      await store.kv.hset(
        `nq:emit-tracking:${runId}`,
        `${eventName}:complete`,
        Date.now().toString()
      )
      
      // 4. Remove pending marker
      await store.kv.hdel(
        `nq:emit-tracking:${runId}`,
        `${eventName}:pending`
      )
    } catch (err) {
      logger.error('Emit tracking failed', { runId, eventName, err })
    }
  })()
  
  await trackingPromise
}
```

#### Orchestration Wait Logic

```typescript
// Instance B: Orchestrates (acquired lock)
const handleOrchestration = async (event) => {
  const runId = event.runId
  
  // Acquire lock first
  const lockKey = `nq:orch-lock:${runId}`
  const acquired = await store.kv.set(lockKey, instanceId, {
    ex: 10,
    nx: true
  })
  
  if (!acquired) {
    logger.debug('Orchestration lock held by another instance', { runId })
    return
  }
  
  try {
    // Wait for any pending emit tracking
    const trackingKey = `nq:emit-tracking:${runId}`
    const maxWaitTime = 5000 // 5 seconds max
    const startTime = Date.now()
    
    while (Date.now() - startTime < maxWaitTime) {
      // Check if any pending markers exist
      const pendingKeys = await store.kv.hkeys(trackingKey)
      const hasPending = pendingKeys.some(key => key.endsWith(':pending'))
      
      if (!hasPending) {
        break // All emit tracking complete
      }
      
      // Wait and retry
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    
    // Proceed with orchestration
    await checkAndTriggerPendingSteps(flowName, runId, store)
    
  } finally {
    // Always release lock
    await store.kv.del(lockKey)
  }
}
```

### Terminal Event Deduplication

**Problem:** Multiple instances might analyze flow completion simultaneously and publish duplicate terminal events.

**Solution:** Use Redis lock before publishing terminal events.

```typescript
// In analyzeFlowCompletion logic
if (finalStatus === 'completed' || finalStatus === 'failed') {
  const eventType = finalStatus === 'completed' ? 'flow.completed' : 'flow.failed'
  
  // Try to acquire terminal event lock
  const terminalLockKey = `nq:terminal-lock:${runId}`
  const canPublish = await store.kv.set(terminalLockKey, instanceId, {
    ex: 10,
    nx: true
  })
  
  if (!canPublish) {
    logger.debug('Terminal event already published by another instance', {
      runId,
      eventType
    })
    return
  }
  
  // Check stream to verify no terminal event exists
  const allEvents = await store.stream.read(streamName)
  const terminalExists = allEvents.some(e => 
    e.type === 'flow.completed' || e.type === 'flow.failed'
  )
  
  if (!terminalExists) {
    // Publish terminal event
    await stream.publish('nq:internal:events', {
      type: eventType,
      runId,
      flowName,
      data: {}
    })
    
    logger.info('Published terminal event', { runId, eventType, instanceId })
  }
  
  // Lock auto-expires after 10s, no need to delete
}
```

### StreamAdapter Integration

**New Internal Event Channel:**

```typescript
// In flowWiring.ts start()

const INTERNAL_EVENT_CHANNEL = 'nq:internal:events'

// Subscribe to internal event channel (all instances)
await stream.subscribe(INTERNAL_EVENT_CHANNEL, async (message) => {
  const event = JSON.parse(message)
  
  // Process in order: Persistence → Orchestration → Stats
  await handlePersistence(event)
  await handleOrchestration(event) // Uses lock internally
  await handleFlowStats(event)
})

// Publish events to channel (any instance)
const publishInternalEvent = async (event: EventRecord) => {
  await stream.publish(INTERNAL_EVENT_CHANNEL, JSON.stringify(event))
}
```

**Migration Strategy:**

```typescript
// Support both modes: single instance (local bus) and distributed (stream)
const isDistributed = () => {
  const config = useRuntimeConfig()
  return config.nvent.distributed?.enabled ?? false
}

if (isDistributed()) {
  // Use StreamAdapter for cross-instance coordination
  await stream.subscribe(INTERNAL_EVENT_CHANNEL, handleEvent)
} else {
  // Use local event bus (current behavior)
  bus.onType('step.completed', handleEvent)
}
```

## Implementation Plan

### Phase 1: Foundation (Week 1)

1. **Add distributed configuration**
   ```typescript
   // nuxt.config.ts
   nvent: {
     distributed: {
       enabled: process.env.NVENT_DISTRIBUTED === 'true',
       locks: {
         orchestration: { ttl: 10 }, // seconds
         terminal: { ttl: 10 },
         emitTracking: { ttl: 60 }
       }
     }
   }
   ```

2. **Create distributed coordination utilities**
   - `packages/nvent/src/runtime/utils/distributedLock.ts`
   - `packages/nvent/src/runtime/utils/emitTrackingCoordinator.ts`

3. **Extend StoreAdapter interface**
   - Ensure KV operations support: `set(key, value, opts)`, `get()`, `del()`, `hset()`, `hget()`, `hkeys()`, `hdel()`

### Phase 2: Emit Tracking Migration (Week 2)

1. **Replace in-memory `pendingEmitTracking` Map**
   - Use `EmitTrackingCoordinator` class
   - Methods: `markPending()`, `markComplete()`, `waitForCompletion()`

2. **Update emit event handler**
   - Mark pending before tracking
   - Mark complete after tracking
   - Handle errors and cleanup

3. **Update orchestration handler**
   - Check Redis for pending emit tracking
   - Wait with timeout (5s max)

### Phase 3: Orchestration Lock (Week 3)

1. **Add orchestration lock acquisition**
   - Before `checkAndTriggerPendingSteps()`
   - Per-runId lock scope
   - 10s TTL with auto-expiry

2. **Handle lock failures gracefully**
   - Log which instance won lock
   - Early return for losers
   - Metrics for lock contention

3. **Test failure scenarios**
   - Instance crash during orchestration
   - Lock expiry before completion
   - Idempotent step enqueueing

### Phase 4: Terminal Event Deduplication (Week 4)

1. **Add terminal event lock**
   - Before publishing flow.completed/failed
   - Check stream for existing terminal event
   - Idempotent publish

2. **Replace `publishingTerminalEvents` Set**
   - Use Redis key instead of in-memory Set
   - Cross-instance coordination

### Phase 5: StreamAdapter Integration (Week 5)

1. **Add internal event channel subscription**
   - Subscribe all instances to `nq:internal:events`
   - Route messages to existing handlers

2. **Replace local event bus publishing**
   - Publish to StreamAdapter instead of local bus
   - Maintain backward compatibility with feature flag

3. **Add event ordering guarantees**
   - Ensure per-runId ordering in StreamAdapter
   - Handle out-of-order delivery

### Phase 6: Testing & Optimization (Week 6)

1. **Multi-instance integration tests**
   - 3 instances processing same flow
   - Verify single orchestration
   - Verify no duplicate steps

2. **Performance benchmarking**
   - Compare latency: single vs distributed
   - Measure lock contention
   - Optimize hot paths

3. **Observability**
   - Add metrics for lock acquisition rates
   - Track orchestration latency per instance
   - Monitor emit tracking wait times

## Migration Path

### For Users

**No Breaking Changes:**
- Default: Single instance mode (local event bus)
- Opt-in: Enable distributed mode via config
- All existing deployments continue working

**Configuration:**
```typescript
// Single instance (default, no change)
export default defineNuxtConfig({
  nvent: {
    // distributed not set → local event bus
  }
})

// Multi-instance (opt-in)
export default defineNuxtConfig({
  nvent: {
    distributed: {
      enabled: true // Enables StreamAdapter coordination
    }
  }
})
```

### For Developers

**Code Changes:**
1. flowWiring.ts: Add lock acquisition logic
2. flowWiring.ts: Replace Map with Redis-backed coordinator
3. flowWiring.ts: Subscribe to StreamAdapter instead of local bus
4. Feature flag: Check `isDistributed()` before choosing mode

**Testing:**
1. Unit tests: Mock distributed locks
2. Integration tests: Redis + multiple processes
3. E2E tests: docker-compose with 3 instances

## Edge Cases & Failure Modes

### 1. Lock Expiry During Orchestration

**Scenario:** Orchestration takes >10s (lock expires mid-flight)

**Consequences:**
- Another instance acquires lock
- Two instances orchestrate simultaneously
- BullMQ job IDs prevent duplicate enqueue (idempotent)

**Mitigation:**
- Keep lock TTL reasonable (10s)
- Monitor orchestration latency
- Alert if >5s (indicates problem)

**Recovery:**
- Duplicate orchestration is safe (idempotent operations)
- Worst case: Same step enqueued twice → BullMQ deduplicates

### 2. Instance Crash During Emit Tracking

**Scenario:** Instance crashes after `markPending()` but before `markComplete()`

**Consequences:**
- Redis has `{eventName}:pending` marker forever
- Other instances wait for completion (timeout)

**Mitigation:**
- Set TTL on emit tracking hash (60s)
- Orchestration wait timeout (5s max)
- After timeout, proceed with orchestration

**Recovery:**
- Emit tracking retries (optimistic locking)
- Eventually marks complete or TTL expires

### 3. Network Partition

**Scenario:** Instance can't reach Redis but continues processing

**Consequences:**
- Instance can't acquire locks
- Instance doesn't orchestrate
- Other instances handle orchestration

**Mitigation:**
- Redis connection health checks
- Fail fast if Redis unavailable
- Circuit breaker pattern

**Recovery:**
- Instance rejoins after partition heals
- No data loss (Redis is source of truth)

### 4. StreamAdapter Message Loss

**Scenario:** Message published but not received by some instances

**Consequences:**
- Some instances miss event
- But: Persistence is idempotent (appending to stream)
- But: Orchestration happens by any instance that receives event

**Mitigation:**
- StreamAdapter reliability (Redis Streams has at-least-once delivery)
- Event sourcing: All events in stream, can replay

**Recovery:**
- Events are persisted in Redis Streams
- Can reprocess from stream if needed

### 5. Clock Skew Between Instances

**Scenario:** Instances have different system clocks

**Consequences:**
- Timestamps may be inconsistent
- Lock expiry based on Redis clock (consistent)

**Mitigation:**
- Use Redis TIME command for timestamps
- Redis handles lock expiry (server-side)

**Recovery:**
- Lock mechanism not affected (Redis server time)
- Timestamps may drift but don't affect correctness

## Performance Considerations

### Latency Analysis

**Single Instance (Baseline):**
- Event publish to local bus: <1ms
- Handler execution: 10-50ms
- Total: ~50ms

**Distributed Mode:**
- StreamAdapter publish: 1-5ms (Redis XADD)
- Lock acquisition: 1-2ms (Redis SET NX)
- Handler execution: 10-50ms
- Lock release: 1ms (Redis DEL)
- Total: ~60-70ms

**Overhead: +10-20ms per event (~20% increase)**

### Throughput Analysis

**Lock Contention:**
- Per-runId locks → N concurrent flows = N concurrent orchestrations
- No global serialization bottleneck
- Scales linearly with number of flows

**Redis Load:**
- Writes: 2 per event (lock + data)
- Reads: 1-2 per orchestration (emit tracking check)
- Estimate: 100 events/sec = 200-400 Redis ops/sec (trivial)

### Scaling Limits

**Instance Count:**
- 10 instances: No contention (per-runId locks)
- 50 instances: Minimal contention (unlikely to orchestrate same flow)
- 100+ instances: Consider sharding by flowName

**Flow Throughput:**
- Single flow: 10-20 steps/sec (lock serialization)
- 100 concurrent flows: 1000-2000 steps/sec
- Limited by Redis throughput (~10K ops/sec typical)

## Monitoring & Observability

### Metrics to Track

1. **Lock Metrics:**
   - `nvent.lock.orchestration.acquired` (counter)
   - `nvent.lock.orchestration.failed` (counter)
   - `nvent.lock.orchestration.duration` (histogram)
   - `nvent.lock.orchestration.wait_time` (histogram)

2. **Emit Tracking Metrics:**
   - `nvent.emit_tracking.pending` (gauge)
   - `nvent.emit_tracking.wait_time` (histogram)
   - `nvent.emit_tracking.timeout` (counter)

3. **Orchestration Metrics:**
   - `nvent.orchestration.latency` (histogram)
   - `nvent.orchestration.by_instance` (counter with label)
   - `nvent.orchestration.duplicate` (counter - should be 0)

4. **Terminal Event Metrics:**
   - `nvent.terminal_event.published` (counter)
   - `nvent.terminal_event.duplicate_prevented` (counter)

### Log Statements

```typescript
// Lock acquisition
logger.info('Orchestration lock acquired', {
  runId,
  flowName,
  instanceId,
  lockKey
})

logger.debug('Orchestration lock held by another instance', {
  runId,
  instanceId,
  lockKey
})

// Emit tracking
logger.debug('Waiting for emit tracking', {
  runId,
  pendingEvents: ['approval.requested'],
  waitTime: 123
})

logger.warn('Emit tracking wait timeout', {
  runId,
  pendingEvents: ['approval.requested'],
  maxWaitTime: 5000
})

// Terminal events
logger.info('Terminal event published', {
  runId,
  flowName,
  eventType: 'flow.completed',
  instanceId
})

logger.debug('Terminal event already exists', {
  runId,
  flowName,
  instanceId
})
```

## Open Questions

1. **Should we support fallback to local bus if StreamAdapter unavailable?**
   - Pro: Graceful degradation
   - Con: Inconsistent behavior, hard to test
   - Decision: No, fail fast if Redis unavailable in distributed mode

2. **Should locks be renewable (heartbeat) or fixed TTL?**
   - Pro (renewable): Handles slow orchestration
   - Con (renewable): More complex, more Redis calls
   - Decision: Fixed TTL (10s), alert if orchestration >5s

3. **Should emit tracking be per-event or per-flow?**
   - Current: Per-flow (all emits in one hash)
   - Alternative: Per-event (separate keys)
   - Decision: Per-flow (fewer keys, atomic operations)

4. **Should we support partial distributed mode (e.g., only orchestration)?**
   - Use case: Hybrid mode for testing
   - Complexity: Multiple code paths
   - Decision: All-or-nothing (single flag: `distributed.enabled`)

5. **What's the migration path for active flows when enabling distributed mode?**
   - Scenario: Flows in progress when config changes
   - Options: Drain old flows, graceful cutover, reject new flows
   - Decision: Require restart with drained flows (document in migration guide)

## Success Criteria

1. **Correctness:**
   - [ ] No duplicate step enqueueing in 3-instance test
   - [ ] Terminal events published exactly once
   - [ ] Emit tracking coordination prevents race conditions

2. **Performance:**
   - [ ] <100ms latency overhead vs single instance
   - [ ] Support 100 concurrent flows across 10 instances
   - [ ] Lock contention <5% of orchestration attempts

3. **Reliability:**
   - [ ] Instance crash during orchestration recovered automatically
   - [ ] Lock expiry doesn't corrupt flow state
   - [ ] Redis connection loss fails gracefully

4. **Compatibility:**
   - [ ] Single instance mode unchanged (no regression)
   - [ ] Feature flag toggles between modes without code changes
   - [ ] All existing tests pass in both modes

## Risks & Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Lock contention degrades performance | Medium | Low | Per-runId locks, not global |
| Instance crash leaves orphaned locks | High | Medium | 10s auto-expiry, monitoring |
| Redis connection loss breaks orchestration | High | Low | Circuit breaker, fail fast |
| StreamAdapter message loss causes missing events | High | Low | Redis Streams guarantees, event sourcing |
| Clock skew causes timestamp issues | Low | Low | Use Redis TIME command |
| Emit tracking timeout causes premature orchestration | Medium | Medium | Wait timeout (5s), idempotent operations |

## Conclusion

This design enables horizontal scaling of nvent by:

1. **Separating broadcast from orchestration** - StreamAdapter distributes events, locks ensure single orchestration
2. **Moving in-memory state to Redis** - `pendingEmitTracking` Map → Redis Hash
3. **Using per-runId locks** - Avoids global serialization bottleneck
4. **Maintaining backward compatibility** - Feature flag for single vs distributed mode
5. **Ensuring correctness via idempotency** - BullMQ job IDs, lock-protected terminal events

**Trade-offs:**
- ✅ Enables horizontal scaling without sticky sessions
- ✅ Automatic failover (lock expiry)
- ✅ Simple implementation (Redis primitives)
- ⚠️ +10-20ms latency per event
- ⚠️ Increased Redis dependency (already required)
- ⚠️ More complex failure modes (network partitions)

**Next Steps:**
1. Review this spec with team
2. Validate design assumptions with prototype
3. Implement Phase 1-2 (foundation + emit tracking)
4. Test with 3-instance docker-compose setup
5. Iterate based on findings

---

**Reviewers:** Please focus on:
- Lock granularity: Per-runId sufficient?
- Emit tracking coordination: Redis Hash vs separate keys?
- Failure modes: Missing any edge cases?
- Performance: 20% overhead acceptable?
