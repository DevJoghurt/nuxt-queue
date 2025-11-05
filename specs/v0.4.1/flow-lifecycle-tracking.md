# Flow Lifecycle Tracking

**Version:** v0.5  
**Status:** Planned  
**Created:** 2025-11-05

## Overview

Implement automatic flow lifecycle state tracking in the flow index to enable horizontal scalability and eliminate the need for in-memory state to determine flow completion status.

## Problem Statement

Currently, there is no reliable way to determine if a flow is `running`, `completed`, or `failed` across multiple instances without:
1. Reading the entire event stream for each run
2. Maintaining in-memory state (not horizontally scalable)
3. Manual tracking of completion status

This creates issues:
- **Missing `flow.completed` events:** If an instance crashes after persisting `step.completed` but before checking flow completion
- **No status filtering:** Cannot query "show me all running flows" without reading all event streams
- **Scalability concerns:** Each instance needs to track state independently

## Solution

Enhance the flow index to store lifecycle metadata alongside each run entry, and automatically update the status based on flow analysis and incoming events.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Worker Instance A                                           │
│  ┌──────────────┐    step.completed    ┌─────────────────┐ │
│  │ Step Worker  │───────────────────────▶│  Event Bus      │ │
│  └──────────────┘                       │  (Local)        │ │
│                                         └────────┬────────┘ │
│                                                  │          │
│                                         ┌────────▼────────┐ │
│                                         │  Flow Wiring    │ │
│                                         │                 │ │
│                                         │ 1. Persist event│ │
│                                         │ 2. Check status │ │
│                                         │ 3. Update index │ │
│                                         └────────┬────────┘ │
└──────────────────────────────────────────────────┼──────────┘
                                                   │
                                         ┌─────────▼─────────┐
                                         │   Redis           │
                                         │                   │
                                         │ Event Streams:    │
                                         │  nq:flow:{runId}  │
                                         │                   │
                                         │ Index:            │
                                         │  nq:flow:idx:{fn} │
                                         │  - score: ts      │
                                         │  - member: runId  │
                                         │  - metadata: {    │
                                         │      status,      │
                                         │      startedAt,   │
                                         │      completedAt  │
                                         │    }              │
                                         └───────────────────┘
```

## Implementation Details

### 1. Enhance Index Storage

**Current:**
```typescript
interface IndexEntry {
  id: string      // runId
  score: number   // timestamp
}
```

**Proposed:**
```typescript
interface IndexEntry {
  id: string      // runId
  score: number   // timestamp
  metadata?: {
    status: 'running' | 'completed' | 'failed'
    startedAt: number
    completedAt?: number
    stepCount?: number
    completedSteps?: number
  }
}
```

### 2. Update Adapter Interface

**File:** `src/runtime/server/events/types.ts`

```typescript
export interface EventStoreAdapter {
  // ... existing methods ...
  
  // Enhanced index operations
  indexAdd?(key: string, id: string, score: number, metadata?: Record<string, any>): Promise<void>
  indexGet?(key: string, id: string): Promise<IndexEntry | null>
  indexUpdate?(key: string, id: string, metadata: Record<string, any>): Promise<void>
}
```

### 3. Update Redis Adapter

**File:** `src/runtime/server/events/adapters/redis/redisAdapter.ts`

Store metadata in a separate hash:
```typescript
async indexAdd(key: string, id: string, score: number, metadata?: Record<string, any>): Promise<void> {
  await redis.zadd(key, score, id)
  
  if (metadata) {
    const metaKey = `${key}:meta:${id}`
    await redis.hset(metaKey, metadata)
  }
}

async indexGet(key: string, id: string): Promise<IndexEntry | null> {
  const score = await redis.zscore(key, id)
  if (!score) return null
  
  const metaKey = `${key}:meta:${id}`
  const metadata = await redis.hgetall(metaKey)
  
  return {
    id,
    score: Number.parseFloat(score),
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined
  }
}

async indexUpdate(key: string, id: string, metadata: Record<string, any>): Promise<void> {
  const metaKey = `${key}:meta:${id}`
  await redis.hset(metaKey, metadata)
}
```

### 4. Flow Completion Detection

**File:** `src/runtime/server/events/wiring/flowWiring.ts`

Add completion detection logic:

```typescript
import { $useAnalyzedFlows } from '#imports'

async function checkAndUpdateFlowStatus(
  flowName: string, 
  runId: string, 
  streamName: string,
  store: ReturnType<typeof useEventStore>
) {
  // 1. Get flow metadata from registry
  const flows = $useAnalyzedFlows()
  const flowMeta = flows.find(f => f.id === flowName)
  if (!flowMeta) return
  
  // 2. Check current status in index (idempotency)
  const indexKey = store.names().flowIndex(flowName)
  const currentEntry = await store.indexGet(indexKey, runId)
  
  if (currentEntry?.metadata?.status === 'completed' || 
      currentEntry?.metadata?.status === 'failed') {
    return // Already in terminal state
  }
  
  // 3. Read all events for this run
  const events = await store.read(streamName)
  
  // 4. Analyze completion status
  const analysis = analyzeFlowCompletion(flowMeta, events)
  
  // 5. Update index if status changed
  if (analysis.status !== currentEntry?.metadata?.status) {
    await store.indexUpdate(indexKey, runId, {
      status: analysis.status,
      completedAt: analysis.completedAt,
      stepCount: analysis.totalSteps,
      completedSteps: analysis.completedSteps,
    })
    
    // 6. Emit terminal event if flow completed/failed
    if (analysis.status === 'completed' || analysis.status === 'failed') {
      const hasTerminalEvent = events.some(e => 
        e.type === 'flow.completed' || e.type === 'flow.failed'
      )
      
      if (!hasTerminalEvent) {
        await bus.publish({
          type: `flow.${analysis.status}`,
          runId,
          flowName,
          data: {
            duration: analysis.completedAt - analysis.startedAt,
            stepCount: analysis.totalSteps,
          }
        })
      }
    }
  }
}

function analyzeFlowCompletion(flowMeta: any, events: EventRecord[]) {
  const analyzed = analyzeFlow(flowMeta)
  const allSteps = Object.keys(analyzed.steps)
  
  const completedSteps = new Set<string>()
  const failedSteps = new Set<string>()
  let startedAt = 0
  let completedAt = 0
  
  for (const event of events) {
    if (event.type === 'flow.start') {
      startedAt = event.ts
    }
    if (event.type === 'step.completed' && event.stepName) {
      completedSteps.add(event.stepName)
    }
    if (event.type === 'step.failed' && event.stepName) {
      failedSteps.add(event.stepName)
    }
  }
  
  const totalSteps = allSteps.length
  const hasFailures = failedSteps.size > 0
  const allCompleted = allSteps.every(step => 
    completedSteps.has(step) || failedSteps.has(step)
  )
  
  let status: 'running' | 'completed' | 'failed' = 'running'
  
  if (allCompleted) {
    status = hasFailures ? 'failed' : 'completed'
    completedAt = Date.now()
  }
  
  return {
    status,
    totalSteps,
    completedSteps: completedSteps.size,
    startedAt,
    completedAt,
  }
}
```

### 5. Update Flow Wiring Event Handler

```typescript
const handleFlowEvent = async (e: EventRecord) => {
  // ... existing persistence logic ...
  
  // For flow.start, initialize index with running status
  if (e.type === 'flow.start') {
    const timestamp = new Date(rec.ts || Date.now()).getTime()
    await store.indexAdd(indexKey, runId, timestamp, {
      status: 'running',
      startedAt: timestamp,
      stepCount: 0,
      completedSteps: 0,
    })
  }
  
  // For step completion/failure, check flow status
  if (e.type === 'step.completed' || e.type === 'step.failed') {
    await checkAndUpdateFlowStatus(flowName, runId, streamName, store)
  }
  
  // For manual flow.completed/flow.failed events, update index
  if (e.type === 'flow.completed' || e.type === 'flow.failed') {
    const status = e.type === 'flow.completed' ? 'completed' : 'failed'
    await store.indexUpdate(indexKey, runId, {
      status,
      completedAt: new Date(rec.ts || Date.now()).getTime(),
    })
  }
}
```

## API Changes

### Enhanced Runs Query

**File:** `src/runtime/server/api/_flows/[name]/runs.get.ts`

Support filtering by status:

```typescript
export default defineEventHandler(async (event) => {
  const flowName = getRouterParam(event, 'name')
  const query = getQuery(event)
  const status = query.status as 'running' | 'completed' | 'failed' | undefined
  
  // ... existing logic ...
  
  const entries = await store.indexRead(runIndexKey, { offset, limit })
  
  // Filter by status if provided
  const filteredEntries = status 
    ? entries.filter(e => e.metadata?.status === status)
    : entries
  
  const items = filteredEntries.map(entry => ({
    id: entry.id,
    flowName,
    status: entry.metadata?.status || 'unknown',
    createdAt: new Date(entry.score).toISOString(),
    completedAt: entry.metadata?.completedAt 
      ? new Date(entry.metadata.completedAt).toISOString() 
      : undefined,
  }))
  
  return { items, total, hasMore }
})
```

## Performance Considerations

### Optimization Strategies

1. **Cache Flow Metadata**
   - Load flow metadata once on server start
   - Watch for HMR changes and reload

2. **Lazy Status Checks**
   - Only check completion on `step.completed`/`step.failed` events
   - Skip for `log`, `emit`, `state` events

3. **Event Pagination**
   - Don't read entire stream if not needed
   - Use last known event ID to read only new events

4. **Redis Pipeline**
   - Batch `indexUpdate` operations
   - Use Redis transactions for atomic updates

5. **Background Reconciliation**
   - Optional periodic job to check "stuck" running flows
   - Detect and fix missing `flow.completed` events

## Migration Strategy

### Phase 1: Add Metadata Support
- Update adapter interfaces
- Implement Redis hash storage for metadata
- Default to empty metadata for existing entries

### Phase 2: Add Status Tracking
- Implement `checkAndUpdateFlowStatus` logic
- Update flow wiring to call on step events
- Backfill existing runs with status (optional)

### Phase 3: Enable Status Filtering
- Update API endpoints to support status queries
- Update UI to show status badges from index metadata

## Testing

### Unit Tests
- Test `analyzeFlowCompletion` with various event sequences
- Test idempotency (multiple updates with same status)
- Test concurrent updates from parallel steps

### Integration Tests
- Test full flow lifecycle tracking
- Test status transitions: running → completed
- Test status transitions: running → failed
- Test missing event recovery

### Load Tests
- Test performance with 1000+ concurrent flows
- Test event stream reading performance
- Test Redis metadata storage/retrieval

## Open Questions

1. **Backfill Strategy:** Should we backfill status for existing runs?
2. **TTL:** Should metadata expire with the event stream or independently?
3. **Cleanup:** When should we remove metadata entries?
4. **Monitoring:** How to alert on "stuck" flows?

## Related Specifications

- [v0.4 Event Schema](../v0.4/event-schema.md)
- [v0.4 Flow Scheduling](../v0.4/flow-scheduling.md)
- [v0.6 State Cleanup Strategies](../v0.4/state-cleanup-strategies.md)

## Future Enhancements (v0.6+)

- Add duration tracking in metadata
- Add retry count tracking
- Add failure reason tracking
- Support custom metadata fields
- Add status transition events (running → completed)
