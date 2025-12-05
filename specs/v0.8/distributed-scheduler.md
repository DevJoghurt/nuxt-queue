# Distributed Scheduler Architecture

## Current Implementation (v0.5)

### Simple Polling Approach
- **How it works**: Every 30 seconds, each instance queries the store for all persisted jobs and recovers any missing jobs
- **Pros**: Simple, works with any store adapter, no additional infrastructure
- **Cons**: 30-second sync delay, repeated queries to store, scales poorly with many instances

### Distributed Locking
All instances schedule the same jobs in-memory, but only one executes via distributed locking:
- Each timer fires on every instance
- `acquireLock(jobId)` ensures only one instance acquires the lock
- Other instances skip execution
- If the executing instance crashes, another takes over automatically

## Horizontal Scaling Evaluation

### Problem Analysis

**Current Issues**:
1. Periodic polling (30s) creates sync delay and wastes resources
2. All instances have redundant timers (memory/CPU waste)
3. Doesn't leverage existing event bus infrastructure
4. Different pattern from triggers (inconsistency)

**Why NOT Trigger Pattern**:
- Triggers are **long-lived, static** (defined at build time, rarely change)
- Scheduled jobs are **short-lived, dynamic** (created per flow execution, thousands per hour)
- Trigger index would grow unbounded with completed jobs
- Loading entire scheduler index on startup would be slow with 10k+ jobs

### Recommended Architecture: Event-Driven Scheduler

**Core Principle**: Use existing event bus for job coordination, not index-based loading.

#### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Job Creation (Any Instance)              │
├─────────────────────────────────────────────────────────────┤
│ 1. Persist job to store (nvent:scheduler:jobs:{jobId})     │
│ 2. Publish scheduler.job.created event to event bus        │
│ 3. Create local in-memory timer                            │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              All Instances Listen (Event Bus)               │
├─────────────────────────────────────────────────────────────┤
│ schedulerWiring subscribes to scheduler.job.created         │
│ → Fetch job from store                                      │
│ → Create local in-memory timer                              │
│ → All instances now have the same timers                    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│            Timer Fires (All Instances)                      │
├─────────────────────────────────────────────────────────────┤
│ 1. Try to acquire distributed lock                          │
│ 2. If lock acquired: execute job                            │
│ 3. If lock failed: skip (another instance has it)          │
│ 4. Publish scheduler.job.executed event                     │
│ 5. Clean up job from store                                  │
└─────────────────────────────────────────────────────────────┘
```

#### Key Components

**1. Scheduler Wiring** (like trigger-wiring.ts)
```typescript
// packages/nvent/src/runtime/scheduler/scheduler-wiring.ts
export function setupSchedulerWiring() {
  const bus = getEventBus()
  const store = useStoreAdapter()
  const scheduler = useScheduler()

  // Listen for job creation events
  bus.subscribe('scheduler.job.created', async (event) => {
    const { jobId } = event.data
    
    // Fetch job from store
    const jobKey = `nvent:scheduler:jobs:${jobId}`
    const jobData = await store.kv.get(jobKey)
    
    if (jobData && !scheduler.has(jobId)) {
      // Recover job (create in-memory timer)
      await scheduler.recoverJob(jobData)
    }
  })

  // Listen for job completion (for cleanup)
  bus.subscribe('scheduler.job.executed', async (event) => {
    const { jobId, success } = event.data
    
    // Clean up one-time jobs
    if (success && event.data.type === 'one-time') {
      await scheduler.unschedule(jobId)
    }
  })
}
```

**2. Modified Scheduler**
```typescript
class Scheduler {
  async schedule(job: ScheduledJob): Promise<string> {
    // 1. Persist to store
    await this.persistJob(job)
    
    // 2. Create local timer
    this.createTimer(job)
    
    // 3. Notify other instances via event bus (NOT store polling)
    const bus = getEventBus()
    await bus.publish({
      type: 'scheduler.job.created',
      data: { 
        jobId: job.id,
        instanceId: this.instanceId,
      }
    })
    
    return job.id
  }
  
  private async executeWithLock(job: ScheduledJob) {
    // ... existing lock logic ...
    
    if (success) {
      // Publish execution event for other instances to clean up
      await bus.publish({
        type: 'scheduler.job.executed',
        data: { 
          jobId: job.id,
          success: true,
          type: job.type,
        }
      })
    }
  }
}
```

**3. Store Layout** (simpler than triggers)
```
nvent:scheduler:jobs:{jobId}     → Job config (KV, auto-cleanup on completion)
nvent:scheduler:locks:{jobId}    → Distributed locks (index, TTL-based)
nvent:scheduler:stats:{jobId}    → Runtime stats (KV, optional)
```

**No persistent index needed** - jobs are ephemeral, event bus handles sync.

### Benefits vs. Other Approaches

| Approach | Sync Speed | Store Load | Memory | Complexity | Notes |
|----------|------------|------------|--------|------------|-------|
| **Polling (current)** | 30s | High | High | Low | Simple but wasteful |
| **Event Bus (recommended)** | <1s | Low | High | Medium | Reuses existing infra |
| **Trigger Index** | Startup | Medium | Low | Medium | Wrong pattern (jobs ≠ triggers) |
| **Pub/Sub Adapter** | <1s | Low | High | High | Need adapter changes |
| **Leader Election** | N/A | None | Low | Very High | Overkill, SPOF risk |

### Why Event Bus is Optimal

✅ **Already exists** - No new infrastructure, reuse event bus
✅ **Fast sync** - <1 second notification via stream.subscribe
✅ **Store-agnostic** - Works with any adapter (Postgres, Redis, file)
✅ **Consistent** - Same pattern as flow.start, step.completed events
✅ **No polling** - Event-driven, not periodic queries
✅ **Natural cleanup** - scheduler.job.executed event triggers cleanup
✅ **Distributed** - Works across instances automatically

❌ **Memory per instance** - Still redundant timers (acceptable trade-off)

### Performance Characteristics

**Job Creation**:
```
1. store.kv.set()              ~1ms   (persist job)
2. eventBus.publish()          ~5ms   (notify instances)
3. Other instances receive     <100ms (stream subscription)
4. Other instances recover     ~10ms  (fetch + create timer)
───────────────────────────────────────────────────────────
Total sync time: <200ms (vs 0-30s with polling)
```

**Job Execution**:
```
1. Timer fires (all instances)
2. Lock acquisition (one wins)     ~2ms   (index.add with version check)
3. Job execution                   varies (user code)
4. eventBus.publish(executed)      ~5ms   (notify cleanup)
5. Other instances clean up        ~10ms  (delete local timer)
───────────────────────────────────────────────────────────
No wasted work - only winning instance executes logic
```

### Implementation Phases

**Phase 1**: Add scheduler wiring (parallel to polling)
- Create `scheduler-wiring.ts`
- Subscribe to scheduler events
- Keep polling as fallback

**Phase 2**: Modify scheduler to publish events
- Add event bus integration
- Publish on schedule()
- Publish on execute()

**Phase 3**: Remove polling
- Delete `startJobSyncPolling()`
- Rely entirely on event bus

**Phase 4**: Add stream persistence (optional)
- Store scheduler events to stream for debugging
- `nvent:stream:scheduler` → job lifecycle events

### Open Questions to Evaluate

1. **Memory concerns**: With 1000 concurrent flows, each with 2-3 scheduled jobs (stall, webhook timeout), that's 3000 timers per instance. Is this acceptable?
   - **Answer**: Yes - setTimeout/setInterval are lightweight (~200 bytes each = 600KB total)

2. **Event bus overhead**: Does publishing every job creation add significant latency?
   - **Answer**: Need to benchmark - but should be <10ms since it's just stream.append

3. **Race conditions**: If two instances publish job.created simultaneously?
   - **Answer**: Not possible - only one instance creates the job (the one handling the flow event)

4. **Cleanup timing**: What if instance crashes before publishing job.executed?
   - **Answer**: Job persists in store, gets cleaned up by periodic GC (every hour)

### Recommendation

**Implement Event Bus approach** - it's the sweet spot:
- Fast sync (<200ms vs 30s)
- Minimal changes (reuse event bus)
- Store-agnostic
- Consistent with existing patterns

**NOT recommended**:
- ❌ Trigger index pattern (wrong abstraction, unbounded growth)
- ❌ Leader election (too complex, SPOF)
- ❌ Dedicated service (operational overhead)
- ❌ Store adapter pub/sub (requires adapter changes)

## Testing Distributed Behavior

### Test Scenarios

1. **Job created on Instance A**
   - Verify Instance B picks it up within 30s (polling) or <1s (pubsub)
   - Verify only one instance executes

2. **Instance crashes mid-execution**
   - Verify lock expires
   - Verify another instance takes over

3. **Network partition**
   - Verify both sides continue scheduling
   - Verify no duplicate execution (locking)

### Test Setup

```typescript
// Spin up 2 instances with shared store
const store = createPostgresStore(...)
const scheduler1 = new Scheduler({ store, instanceId: 'A' })
const scheduler2 = new Scheduler({ store, instanceId: 'B' })

await scheduler1.start()
await scheduler2.start()

// Schedule on instance A
await scheduler1.schedule({ ... })

// Wait for sync
await sleep(31000) // Polling
// or
await sleep(2000) // Pub/Sub

// Verify instance B has the job
const jobs = await scheduler2.getScheduledJobs()
expect(jobs).toHaveLength(1)
```

## Future Architecture: Align with Trigger System (v0.6+)

### Vision: Unified Scheduling Pattern

**Problem**: Current scheduler uses a different pattern than triggers, causing inconsistency and duplication.

**Solution**: Adopt the trigger system's architecture for all scheduled jobs.

### Trigger System Pattern (Current)

```typescript
// Build-time: Scan and register
const triggers = scanTriggers()
await registerTrigger({
  name: 'daily-cleanup',
  type: 'schedule',
  schedule: '0 2 * * *',
  flowName: 'cleanup-flow'
})

// Store layout
nvent:triggers:index              → All registered triggers
nvent:triggers:stats:{name}       → Runtime stats per trigger
nvent:stream:trigger:{name}       → Event history per trigger

// Runtime: Load from index
const triggers = await loadTriggerIndex()
triggers.forEach(t => {
  if (t.type === 'schedule') {
    scheduleCronJob(t.schedule, () => fireTrigger(t.name))
  }
})

// Distributed: All instances load same index, fire events
```

### Proposed Scheduler Pattern (Future)

```typescript
// Build-time: Register scheduled jobs like triggers
await registerScheduledJob({
  id: 'stall-timeout:run-123',
  type: 'one-time',
  executeAt: timestamp,
  metadata: { component: 'stall-detector', flowName, runId }
})

// Store layout (same as triggers)
nvent:scheduler:index                    → All scheduled jobs
nvent:scheduler:stats:{jobId}            → Runtime stats per job
nvent:stream:scheduler:{jobId}           → Event history per job

// Runtime: Load from index (like triggers)
const jobs = await loadSchedulerIndex()
jobs.forEach(job => {
  if (job.type === 'cron') {
    scheduleCronJob(job.cron, () => executeJob(job.id))
  }
  else if (job.type === 'one-time') {
    scheduleOneTime(job.executeAt, () => executeJob(job.id))
  }
})

// Distributed: All instances load same index
// No periodic polling needed - index is source of truth
```

### Benefits of Trigger Pattern

1. **Consistency**: Same pattern for triggers and scheduled jobs
2. **Build-time Registration**: Jobs registered during build/startup, not dynamically
3. **Single Source of Truth**: Index is authoritative, no sync needed
4. **Event History**: Stream tracks all executions
5. **No Polling**: Instances load index once, not every 30s
6. **Simpler Code**: Reuse trigger infrastructure

### Migration Steps

**Phase 1**: Introduce scheduler index (parallel to current system)
```typescript
// Add index operations
await store.index.add('nvent:scheduler:index', jobId, timestamp, jobData)

// Load on startup
const persistedJobs = await store.index.read('nvent:scheduler:index')
```

**Phase 2**: Move to build-time registration
```typescript
// For flow-related schedules (stall detection, await timeouts)
// Register when flow is triggered, not when scheduled
onFlowStart(flow => {
  registerScheduledJob({
    id: `stall-timeout:${runId}`,
    executeAt: now + stallTimeout,
    metadata: { flowName, runId }
  })
})
```

**Phase 3**: Remove periodic polling
```typescript
// Instead of polling every 30s
// Just load index once on startup
const jobs = await loadSchedulerIndex()
```

**Phase 4**: Add event streams
```typescript
// Track execution history like triggers
await store.stream.append(`nvent:stream:scheduler:${jobId}`, {
  type: 'scheduler.job.executed',
  data: { success: true, duration: 123 }
})
```

### Key Differences from Triggers

| Aspect | Triggers | Scheduled Jobs |
|--------|----------|----------------|
| **Lifespan** | Long-lived (days/months) | Short-lived (seconds/hours) |
| **Count** | Few (10-100) | Many (1000s) |
| **Changes** | Rare (code deploy) | Frequent (every flow) |
| **Registration** | Build-time | Runtime |

**Implication**: Scheduler index needs efficient cleanup for completed/expired jobs, unlike triggers which persist indefinitely.

### Cleanup Strategy

```typescript
// Periodic cleanup of completed/expired jobs from index
setInterval(async () => {
  const now = Date.now()
  const jobs = await store.index.read('nvent:scheduler:index')
  
  for (const job of jobs) {
    if (job.metadata.type === 'one-time' && job.score < now - 3600000) {
      // One-time job completed over 1 hour ago
      await store.index.delete('nvent:scheduler:index', job.id)
    }
  }
}, 3600000) // Every hour
```

### Implementation Checklist

- [ ] Add scheduler index to store layout
- [ ] Implement `loadSchedulerIndex()` similar to `loadTriggerIndex()`
- [ ] Move job registration to use index.add (not just KV)
- [ ] Add event streaming for job executions
- [ ] Implement index cleanup for expired jobs
- [ ] Remove periodic polling (replaced by index load)
- [ ] Update tests to use trigger-like pattern
- [ ] Update docs with new architecture

### See Also

- [Trigger System Implementation](./v0.5/TRIGGER-IMPLEMENTATION.md)
- [Trigger Index Stream](./v0.5/trigger-index-stream.md)
- Current trigger code: `packages/nvent/src/runtime/trigger/`

## References

- [Distributed Locking Patterns](https://redis.io/docs/manual/patterns/distributed-locks/)
- [Leader Election Algorithms](https://en.wikipedia.org/wiki/Leader_election)
- [Scheduler Recovery](./v0.5/scheduler-recovery.md)
