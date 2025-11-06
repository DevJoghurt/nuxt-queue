# Flow Lifecycle Tracking

**Version:** v0.4  
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
- **No multi-dependency waiting:** Steps with multiple `subscribes` trigger immediately on the first matching event, without waiting for all dependencies to complete
- **Premature step execution:** Parallel workflows cannot properly synchronize - a step subscribing to multiple events starts before all parent steps finish

## Solution

Enhance the flow index to store lifecycle metadata alongside each run entry, and automatically update the status based on flow analysis and incoming events. This also enables proper multi-dependency resolution for parallel workflows by tracking which events have been emitted and determining when all step dependencies are satisfied.

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
    emittedEvents?: string[]  // Track which events have been emitted for dependency resolution
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

### 3. Update Adapters with Optimistic Locking

#### Redis Adapter

**File:** `src/runtime/server/events/adapters/redis/redisAdapter.ts`

Store metadata in a separate hash with version tracking for optimistic locking.

**Redis Keys:**
```
nq:flow:idx:{flowName}              # Sorted set (timestamp-based index)
nq:flow:idx:{flowName}:meta:{runId} # Hash (versioned metadata with optimistic locking, includes emittedEvents as JSON)
```

```typescript
async indexAdd(key: string, id: string, score: number, metadata?: Record<string, any>): Promise<void> {
  await redis.zadd(key, score, id)
  
  if (metadata) {
    const metaKey = `${key}:meta:${id}`
    // Store emittedEvents as JSON string in hash
    const toStore = { ...metadata, version: 0 }
    if (toStore.emittedEvents) {
      toStore.emittedEvents = JSON.stringify(toStore.emittedEvents)
    }
    await redis.hset(metaKey, toStore)
  }
}

async indexGet(key: string, id: string): Promise<IndexEntry | null> {
  const score = await redis.zscore(key, id)
  if (!score) return null
  
  const metaKey = `${key}:meta:${id}`
  const metadata = await redis.hgetall(metaKey)
  
  if (Object.keys(metadata).length === 0) return { id, score: Number.parseFloat(score) }
  
  // Parse emittedEvents from JSON string
  if (metadata.emittedEvents) {
    metadata.emittedEvents = JSON.parse(metadata.emittedEvents)
  }
  
  return {
    id,
    score: Number.parseFloat(score),
    metadata
  }
}

async indexUpdate(key: string, id: string, metadata: Record<string, any>): Promise<boolean> {
  const metaKey = `${key}:meta:${id}`
  
  // Get current version
  const current = await redis.hget(metaKey, 'version')
  const currentVersion = current ? parseInt(current) : 0
  
  // Optimistic lock: only update if version matches
  const script = `
    local current = redis.call('HGET', KEYS[1], 'version')
    if current == ARGV[1] then
      for i = 2, #ARGV, 2 do
        redis.call('HSET', KEYS[1], ARGV[i], ARGV[i + 1])
      end
      redis.call('HSET', KEYS[1], 'version', tonumber(ARGV[1]) + 1)
      return 1
    else
      return 0
    end
  `
  
  // Build arguments: [version, key1, val1, key2, val2, ...]
  const args = [currentVersion.toString()]
  for (const [k, v] of Object.entries(metadata)) {
    args.push(k)
    // Serialize arrays as JSON
    args.push(Array.isArray(v) ? JSON.stringify(v) : String(v))
  }
  
  const result = await redis.eval(script, 1, metaKey, ...args)
  return result === 1
}

async indexUpdateWithRetry(
  key: string, 
  id: string, 
  metadata: Record<string, any>,
  maxRetries: number = 3
): Promise<void> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const success = await this.indexUpdate(key, id, metadata)
    
    if (success) return
    
    // Version conflict - exponential backoff
    await new Promise(resolve => setTimeout(resolve, 10 * Math.pow(2, attempt)))
  }
  
  throw new Error(`Failed to update index after ${maxRetries} retries`)
}
```

**TTL Cleanup:**
```typescript
async setMetadataTTL(flowName: string, runId: string, ttlSeconds: number): Promise<void> {
  const metaKey = `nq:flow:idx:${flowName}:meta:${runId}`
  await redis.expire(metaKey, ttlSeconds)
}
```

#### File Store Adapter

**File:** `src/runtime/server/events/adapters/file/fileAdapter.ts`

Store metadata directly in the index JSON file (no versioning needed - single instance).

```typescript
interface FileIndexEntry {
  id: string
  score: number
  status?: 'running' | 'completed' | 'failed'
  startedAt?: number
  completedAt?: number
  stepCount?: number
  completedSteps?: number
  emittedEvents?: string[]
}

async indexAdd(key: string, id: string, score: number, metadata?: Record<string, any>): Promise<void> {
  const indexPath = this.getIndexPath(key)
  const entries = await this.readIndex(indexPath)
  
  entries.push({
    id,
    score,
    ...metadata
  })
  
  await this.writeIndex(indexPath, entries)
}

async indexGet(key: string, id: string): Promise<IndexEntry | null> {
  const indexPath = this.getIndexPath(key)
  const entries = await this.readIndex(indexPath)
  const entry = entries.find(e => e.id === id)
  
  if (!entry) return null
  
  return {
    id: entry.id,
    score: entry.score,
    metadata: {
      status: entry.status,
      startedAt: entry.startedAt,
      completedAt: entry.completedAt,
      stepCount: entry.stepCount,
      completedSteps: entry.completedSteps,
      emittedEvents: entry.emittedEvents
    }
  }
}

async indexUpdate(key: string, id: string, metadata: Record<string, any>): Promise<void> {
  const indexPath = this.getIndexPath(key)
  const entries = await this.readIndex(indexPath)
  const entry = entries.find(e => e.id === id)
  
  if (!entry) throw new Error(`Entry not found: ${id}`)
  
  // Simple merge - no version check needed (single instance)
  Object.assign(entry, metadata)
  
  await this.writeIndex(indexPath, entries)
}

async trackEmittedEvent(flowName: string, runId: string, eventName: string): Promise<void> {
  const indexPath = this.getIndexPath(`nq:flow:idx:${flowName}`)
  const entries = await this.readIndex(indexPath)
  const entry = entries.find(e => e.id === runId)
  
  if (!entry) throw new Error(`Entry not found: ${runId}`)
  
  if (!entry.emittedEvents) entry.emittedEvents = []
  if (!entry.emittedEvents.includes(eventName)) {
    entry.emittedEvents.push(eventName)
    await this.writeIndex(indexPath, entries)
  }
}

async getEmittedEvents(flowName: string, runId: string): Promise<string[]> {
  const indexPath = this.getIndexPath(`nq:flow:idx:${flowName}`)
  const entries = await this.readIndex(indexPath)
  const entry = entries.find(e => e.id === runId)
  
  return entry?.emittedEvents || []
}

private async readIndex(path: string): Promise<FileIndexEntry[]> {
  try {
    const data = await fs.readFile(path, 'utf-8')
    return JSON.parse(data)
  } catch (err) {
    return []
  }
}

private async writeIndex(path: string, entries: FileIndexEntry[]): Promise<void> {
  await fs.mkdir(path.dirname(path), { recursive: true })
  await fs.writeFile(path, JSON.stringify(entries, null, 2), 'utf-8')
}

private getIndexPath(key: string): string {
  // key format: nq:flow:idx:myFlow
  const flowName = key.split(':').pop()
  return path.join(this.basePath, 'indexes', `${flowName}.json`)
}
```

**TTL Cleanup (periodic job):**
```typescript
async cleanupCompletedFlows(flowName: string, retentionMs: number): Promise<void> {
  const indexPath = this.getIndexPath(`nq:flow:idx:${flowName}`)
  const entries = await this.readIndex(indexPath)
  
  const now = Date.now()
  const filtered = entries.filter(entry => {
    // Keep running flows
    if (entry.status === 'running') return true
    
    // Keep recent completed/failed flows
    if (entry.completedAt && (now - entry.completedAt) < retentionMs) return true
    
    // Remove old completed/failed flows
    return false
  })
  
  await this.writeIndex(indexPath, filtered)
}
```

**Example Index File (`.nuxt-queue/indexes/myFlow.json`):**
```json
[
  {
    "id": "run_123",
    "score": 1699200000000,
    "status": "completed",
    "startedAt": 1699200000000,
    "completedAt": 1699200123000,
    "stepCount": 3,
    "completedSteps": 3,
    "emittedEvents": ["step.a.done", "step.b.done"]
  },
  {
    "id": "run_124",
    "score": 1699201000000,
    "status": "running",
    "startedAt": 1699201000000,
    "stepCount": 3,
    "completedSteps": 1,
    "emittedEvents": ["step.a.done"]
  }
]
```

#### Postgres Adapter

**File:** `src/runtime/server/events/adapters/postgres/postgresAdapter.ts`

Store flow runs in a dedicated table with optimistic locking:

```sql
-- Migration: Create flow_runs table
CREATE TABLE flow_runs (
  flow_name VARCHAR(255) NOT NULL,
  run_id VARCHAR(255) NOT NULL,
  created_at BIGINT NOT NULL,
  
  -- Metadata
  status VARCHAR(20) NOT NULL DEFAULT 'running',
  started_at BIGINT NOT NULL,
  completed_at BIGINT,
  step_count INTEGER DEFAULT 0,
  completed_steps INTEGER DEFAULT 0,
  emitted_events TEXT[],  -- Array of emitted event names for dependency tracking
  
  -- Optimistic locking
  version INTEGER NOT NULL DEFAULT 0,
  
  PRIMARY KEY (flow_name, run_id)
);

CREATE INDEX idx_flow_runs_created_at ON flow_runs(flow_name, created_at DESC);
CREATE INDEX idx_flow_runs_status ON flow_runs(flow_name, status);
```

```typescript
async indexAdd(
  flowName: string, 
  runId: string, 
  timestamp: number, 
  metadata?: Record<string, any>
): Promise<void> {
  await this.db.query(`
    INSERT INTO flow_runs (
      flow_name, run_id, created_at, 
      status, started_at, completed_at, 
      step_count, completed_steps, emitted_events, version
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0)
    ON CONFLICT (flow_name, run_id) DO NOTHING
  `, [
    flowName,
    runId,
    timestamp,
    metadata?.status || 'running',
    metadata?.startedAt || timestamp,
    metadata?.completedAt || null,
    metadata?.stepCount || 0,
    metadata?.completedSteps || 0,
    metadata?.emittedEvents || []
  ])
}

async indexGet(flowName: string, runId: string): Promise<IndexEntry | null> {
  const result = await this.db.query(`
    SELECT * FROM flow_runs 
    WHERE flow_name = $1 AND run_id = $2
  `, [flowName, runId])
  
  if (result.rows.length === 0) return null
  
  const row = result.rows[0]
  return {
    id: row.run_id,
    score: row.created_at,
    metadata: {
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      stepCount: row.step_count,
      completedSteps: row.completed_steps,
      emittedEvents: row.emitted_events || [],
      version: row.version
    }
  }
}

async indexUpdate(
  flowName: string, 
  runId: string, 
  metadata: Record<string, any>
): Promise<boolean> {
  // Get current version
  const current = await this.indexGet(flowName, runId)
  if (!current) {
    throw new Error(`Flow run not found: ${flowName}/${runId}`)
  }
  
  const currentVersion = current.metadata.version
  
  // Build SET clause dynamically
  const updates: string[] = []
  const values: any[] = [flowName, runId, currentVersion]
  let paramIndex = 4
  
  if (metadata.status !== undefined) {
    updates.push(`status = $${paramIndex++}`)
    values.push(metadata.status)
  }
  if (metadata.completedAt !== undefined) {
    updates.push(`completed_at = $${paramIndex++}`)
    values.push(metadata.completedAt)
  }
  if (metadata.stepCount !== undefined) {
    updates.push(`step_count = $${paramIndex++}`)
    values.push(metadata.stepCount)
  }
  if (metadata.completedSteps !== undefined) {
    updates.push(`completed_steps = $${paramIndex++}`)
    values.push(metadata.completedSteps)
  }
  if (metadata.emittedEvents !== undefined) {
    updates.push(`emitted_events = $${paramIndex++}`)
    values.push(metadata.emittedEvents)
  }
  
  // Always increment version
  updates.push(`version = version + 1`)
  
  // Update with version check (optimistic lock)
  const result = await this.db.query(`
    UPDATE flow_runs 
    SET ${updates.join(', ')}
    WHERE flow_name = $1 
      AND run_id = $2 
      AND version = $3
    RETURNING version
  `, values)
  
  return result.rowCount > 0
}

async indexUpdateWithRetry(
  flowName: string,
  runId: string,
  metadata: Record<string, any>,
  maxRetries: number = 3
): Promise<void> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const success = await this.indexUpdate(flowName, runId, metadata)
    
    if (success) return
    
    // Version conflict - exponential backoff
    await new Promise(resolve => setTimeout(resolve, 10 * Math.pow(2, attempt)))
  }
  
  throw new Error(`Failed to update flow run after ${maxRetries} retries`)
}

async indexRead(
  flowName: string, 
  opts: { offset?: number, limit?: number, status?: string } = {}
): Promise<Array<IndexEntry>> {
  const offset = opts.offset || 0
  const limit = opts.limit || 50
  
  let query = `
    SELECT * FROM flow_runs 
    WHERE flow_name = $1
  `
  const params: any[] = [flowName]
  let paramIndex = 2
  
  if (opts.status) {
    query += ` AND status = $${paramIndex++}`
    params.push(opts.status)
  }
  
  query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`
  params.push(limit, offset)
  
  const result = await this.db.query(query, params)
  
  return result.rows.map((row: any) => ({
    id: row.run_id,
    score: row.created_at,
    metadata: {
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      stepCount: row.step_count,
      completedSteps: row.completed_steps,
      emittedEvents: row.emitted_events || []
    }
  }))
}
```

**TTL Cleanup (optional scheduled job):**
```typescript
async cleanupCompletedFlows(flowName: string, retentionMs: number): Promise<void> {
  const cutoffTime = Date.now() - retentionMs
  
  await this.db.query(`
    DELETE FROM flow_runs
    WHERE flow_name = $1
      AND status IN ('completed', 'failed')
      AND completed_at < $2
  `, [flowName, cutoffTime])
}
```

### 4. Flow Completion Detection & Step Triggering

**File:** `src/runtime/server/events/wiring/flowWiring.ts`

Add completion detection and multi-dependency resolution logic:

```typescript
import { $useAnalyzedFlows, analyzeFlow } from '#imports'

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
  
  // 5. Check if any pending steps can now be triggered
  const emittedEvents = currentEntry?.metadata?.emittedEvents || []
  await checkPendingStepTriggers(flowMeta, events, runId, flowName, emittedEvents)
  
  // 6. Update index if status changed (with retry on version conflict)
  if (analysis.status !== currentEntry?.metadata?.status) {
    try {
      await store.indexUpdateWithRetry(flowName, runId, {
        status: analysis.status,
        completedAt: analysis.completedAt,
        stepCount: analysis.totalSteps,
        completedSteps: analysis.completedSteps,
      })
    } catch (err) {
      // Log conflict but don't fail - another instance may have updated it
      console.warn('[flow-wiring] Failed to update status after retries', { 
        flowName, runId, error: err.message 
      })
    }
    
    // 7. Emit terminal event if flow completed/failed
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
      
      // 8. Set TTL on metadata (cleanup after retention period)
      const config = useRuntimeConfig().queue
      const metadataRetention = config.metadataRetention || config.eventRetention || 2592000 // 30 days default
      
      await store.setMetadataTTL(flowName, runId, metadataRetention)
    }
  }
}

/**
 * Check if any steps are waiting for dependencies and can now be triggered
 */
async function checkPendingStepTriggers(
  flowMeta: any,
  events: EventRecord[],
  runId: string,
  flowName: string,
  emittedEventsFromIndex: string[]
) {
  const analyzed = analyzeFlow(flowMeta)
  
  // Use emitted events from index (faster than reading all events)
  const emittedEvents = new Set<string>(emittedEventsFromIndex)
  
  // Get all started/completed steps
  const startedSteps = new Set<string>()
  const completedSteps = new Set<string>()
  for (const event of events) {
    if (event.type === 'step.started' && event.stepName) {
      startedSteps.add(event.stepName)
    }
    if ((event.type === 'step.completed' || event.type === 'step.failed') && event.stepName) {
      completedSteps.add(event.stepName)
    }
  }
  
  // Check each step to see if all dependencies are satisfied
  for (const [stepName, step] of Object.entries(analyzed.steps)) {
    // Skip if already started
    if (startedSteps.has(stepName)) continue
    
    // Check if all subscriptions are satisfied
    const subscribes = step.subscribes || []
    const allDependenciesMet = subscribes.length > 0 && subscribes.every(sub => {
      // Check if the event has been emitted
      if (emittedEvents.has(sub)) return true
      
      // Parse subscription to check step-based dependencies
      const [prefix, value] = sub.split(':')
      if (prefix === 'step' && value) {
        return completedSteps.has(value)
      }
      
      return false
    })
    
    if (allDependenciesMet) {
      // Trigger this step by adding it to the appropriate queue
      await triggerStep(flowName, runId, stepName, step, events)
    }
  }
}

/**
 * Trigger a step by adding a job to its queue
 * Collects emit data from all subscribed events
 */
async function triggerStep(
  flowName: string, 
  runId: string, 
  stepName: string, 
  step: any,
  events: EventRecord[]
) {
  const { $useQueue } = await import('#imports')
  const queue = $useQueue(step.queue)
  
  // Collect emit data from all subscribed events
  const emitData: Record<string, any> = {}
  const subscribes = step.subscribes || []
  
  for (const sub of subscribes) {
    // Find the emit event for this subscription
    const emitEvent = events.find(e => 
      e.type === 'emit' && e.data?.event === sub
    )
    
    if (emitEvent && emitEvent.data?.payload !== undefined) {
      emitData[sub] = emitEvent.data.payload
    }
  }
  
  await queue.add(step.workerId, {
    flowId: runId,
    flowName,
    stepName,
    input: emitData,  // Keyed by event name
  }, {
    jobId: `${runId}:${stepName}`,
  })
  
  if (process.env.NQ_DEBUG_EVENTS === '1') {
    console.log('[flow-wiring] triggered step', { 
      flowName, runId, stepName, queue: step.queue, emitData 
    })
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
      emittedEvents: [],
    })
  }
  
  // For emit events, track emitted events in metadata
  if (e.type === 'emit' && e.data?.event) {
    const currentEntry = await store.indexGet(indexKey, runId)
    const emittedEvents = currentEntry?.metadata?.emittedEvents || []
    
    // Add new event if not already tracked
    if (!emittedEvents.includes(e.data.event)) {
      try {
        await store.indexUpdateWithRetry(flowName, runId, {
          emittedEvents: [...emittedEvents, e.data.event],
        })
      } catch (err) {
        console.warn('[flow-wiring] Failed to track emitted event', {
          flowName, runId, event: e.data.event, error: err.message
        })
      }
    }
  }
  
  // For step completion/failure or emit events, check flow status and pending triggers
  if (e.type === 'step.completed' || e.type === 'step.failed' || e.type === 'emit') {
    await checkAndUpdateFlowStatus(flowName, runId, streamName, store)
  }
  
  // For manual flow.completed/flow.failed events, update index with retry
  if (e.type === 'flow.completed' || e.type === 'flow.failed') {
    const status = e.type === 'flow.completed' ? 'completed' : 'failed'
    try {
      await store.indexUpdateWithRetry(flowName, runId, {
        status,
        completedAt: new Date(rec.ts || Date.now()).getTime(),
      })
    } catch (err) {
      console.warn('[flow-wiring] Failed to update terminal status', { 
        flowName, runId, status, error: err.message 
      })
    }
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
- Test `checkPendingStepTriggers` with multi-dependency scenarios
- Test step triggering only when all dependencies are satisfied

### Integration Tests
- Test full flow lifecycle tracking
- Test status transitions: running → completed
- Test status transitions: running → failed
- Test missing event recovery
- Test parallel step execution with multi-dependency waiting:
  - Two parallel steps → third step waits for both
  - Diamond pattern: A → (B, C) → D
  - Complex parallel workflows with multiple synchronization points

### Load Tests
- Test performance with 1000+ concurrent flows
- Test event stream reading performance
- Test Redis metadata storage/retrieval
- Test step trigger checking overhead on high-throughput flows

## Horizontal Scaling Considerations

### Race Conditions Handled by Optimistic Locking

1. **Duplicate Status Updates**
   - **Scenario:** Two instances try to update status simultaneously
   - **Solution:** Version check ensures only one succeeds, loser retries with fresh state
   - **Result:** Consistent status without distributed locks

2. **Duplicate Step Triggers**
   - **Scenario:** Parallel steps complete, both instances try to queue next step
   - **Solution:** BullMQ's jobId deduplication (`${runId}:${stepName}`)
   - **Result:** Step queued exactly once

3. **Clock Skew**
   - **Scenario:** Instance clocks differ, timestamps inconsistent
   - **Solution:** Use database server time (Redis TIME, Postgres NOW())
   - **Result:** Consistent timestamps across instances

4. **Partial Event Reads**
   - **Scenario:** Instance reads events before latest persisted
   - **Solution:** Re-check on every step completion/emit event
   - **Result:** Eventually consistent, triggers fire when all deps met

5. **Lost Completion Events**
   - **Scenario:** Instance crashes before emitting flow.completed
   - **Solution:** Background reconciliation job (future enhancement)
   - **Result:** Stuck flows detected and fixed

### Why Optimistic Locking Over Distributed Locks

**Advantages:**
- ✅ No lock acquisition latency
- ✅ No deadlock risk
- ✅ Simpler implementation (database-native)
- ✅ Better performance (conflicts are rare)
- ✅ No separate locking service needed

**Trade-offs:**
- ⚠️ Requires version column in schema
- ⚠️ Retry logic needed (but conflicts rare in practice)
- ⚠️ Read-modify-write pattern (vs single write with lock)

### Retry Strategy

- **Max retries:** 3 attempts
- **Backoff:** Exponential (10ms, 20ms, 40ms)
- **Failure handling:** Log warning but don't crash (another instance may have succeeded)

## Emit Data Propagation

### Overview

When steps emit events using `ctx.flow.emit(eventName, data)`, the data must be propagated to subscribing steps. This section defines how emit data flows through the workflow.

### Worker Function Signature

**Entry Step (no dependencies):**
```typescript
async function entryWorker(input: any, ctx: WorkerContext) {
  // input is the direct input object provided when starting the flow
  const userId = input.userId
  
  await ctx.flow.emit('user.validated', { userId, status: 'valid' })
}
```

**Non-Entry Step (has dependencies via subscribes):**
```typescript
async function dependentWorker(input: Record<string, any>, ctx: WorkerContext) {
  // input is keyed by emit event name
  const userData = input['stepA.done']  // Data from stepA's emit
  const configData = input['stepB.done'] // Data from stepB's emit
  
  await ctx.flow.emit('processing.complete', { 
    result: processData(userData, configData) 
  })
}
```

### Data Storage in Events

When an emit event is persisted, the data is stored in the event payload:

```typescript
{
  type: 'emit',
  ts: 1699200000000,
  runId: 'run_abc123',
  flowName: 'myFlow',
  stepName: 'stepA',
  data: {
    event: 'stepA.done',      // Event name
    payload: { userId: 123 }  // Emit data
  }
}
```

### Step Triggering with Emit Data

When `triggerStep()` queues a job, it collects emit data from all subscribed events:

```typescript
async function triggerStep(
  flowName: string, 
  runId: string, 
  stepName: string, 
  step: any,
  events: EventRecord[]
) {
  const { $useQueue } = await import('#imports')
  const queue = $useQueue(step.queue)
  
  // Collect emit data from all subscribed events
  const emitData: Record<string, any> = {}
  const subscribes = step.subscribes || []
  
  for (const sub of subscribes) {
    // Find the emit event for this subscription
    const emitEvent = events.find(e => 
      e.type === 'emit' && e.data?.event === sub
    )
    
    if (emitEvent && emitEvent.data?.payload !== undefined) {
      emitData[sub] = emitEvent.data.payload
    }
  }
  
  await queue.add(step.workerId, {
    flowId: runId,
    flowName,
    stepName,
    input: emitData,  // Keyed by event name
  }, {
    jobId: `${runId}:${stepName}`,
  })
  
  if (process.env.NQ_DEBUG_EVENTS === '1') {
    console.log('[flow-wiring] triggered step', { 
      flowName, runId, stepName, queue: step.queue, emitData 
    })
  }
}
```

### Multi-Dependency Data Merging

When a step subscribes to multiple events, all emit data is merged into a single input object keyed by event name:

**Example Flow:**
```typescript
defineFlow({
  entry: 'start',
  steps: {
    start: {
      worker: 'startWorker',
      queue: 'default',
      subscribes: [],
      emits: ['step.a.trigger', 'step.b.trigger']
    },
    parallelA: {
      worker: 'parallelAWorker',
      queue: 'default',
      subscribes: ['step.a.trigger'],
      emits: ['step.a.done']
    },
    parallelB: {
      worker: 'parallelBWorker', 
      queue: 'default',
      subscribes: ['step.b.trigger'],
      emits: ['step.b.done']
    },
    final: {
      worker: 'finalWorker',
      queue: 'default',
      subscribes: ['step.a.done', 'step.b.done']  // Waits for both
    }
  }
})
```

**Worker Implementation:**
```typescript
// Entry step
async function startWorker(input: any, ctx: WorkerContext) {
  const { orderId } = input  // Direct input object
  
  await ctx.flow.emit('step.a.trigger', { orderId, task: 'processPayment' })
  await ctx.flow.emit('step.b.trigger', { orderId, task: 'updateInventory' })
}

// Parallel steps
async function parallelAWorker(input: Record<string, any>, ctx: WorkerContext) {
  const { orderId, task } = input['step.a.trigger']
  
  const result = await processPayment(orderId)
  
  await ctx.flow.emit('step.a.done', { orderId, paymentStatus: result })
}

async function parallelBWorker(input: Record<string, any>, ctx: WorkerContext) {
  const { orderId, task } = input['step.b.trigger']
  
  const result = await updateInventory(orderId)
  
  await ctx.flow.emit('step.b.done', { orderId, inventoryStatus: result })
}

// Final step - receives data from BOTH parallel steps
async function finalWorker(input: Record<string, any>, ctx: WorkerContext) {
  const paymentData = input['step.a.done']    // { orderId, paymentStatus }
  const inventoryData = input['step.b.done']  // { orderId, inventoryStatus }
  
  return {
    orderId: paymentData.orderId,
    payment: paymentData.paymentStatus,
    inventory: inventoryData.inventoryStatus,
    completed: true
  }
}
```

### Return Values

Worker return values are stored by BullMQ as job results but **are NOT automatically propagated** to downstream steps. Steps must use **explicit emits** to pass data:

```typescript
// ❌ WRONG - return value not passed to next step
async function stepA(input: any, ctx: WorkerContext) {
  return { userId: 123 }  // Lost - not propagated
}

// ✅ CORRECT - explicit emit
async function stepA(input: any, ctx: WorkerContext) {
  await ctx.flow.emit('stepA.done', { userId: 123 })
  return { userId: 123 }  // Optional, for BullMQ job result only
}
```

### Implementation Checklist

- [ ] Update `triggerStep()` to collect emit data from events
- [ ] Store emit data in job payload under `input` key
- [ ] Update worker context to pass input as first parameter
- [ ] Document worker signature in flow definition guide
- [ ] Add examples for entry vs non-entry steps
- [ ] Test multi-dependency data merging
- [ ] Add validation for emit data structure

## Metadata Cleanup and TTL

### Automatic Cleanup on Completion

When a flow reaches a terminal state (`completed` or `failed`), metadata keys are automatically set to expire after a configurable retention period.

**Configuration:**
```typescript
export default defineNuxtConfig({
  queue: {
    eventRetention: 604800,      // 7 days (in seconds) - full event streams
    metadataRetention: 2592000,  // 30 days (in seconds) - lightweight metadata
  }
})
```

### Adapter-Specific Cleanup

**Redis:**
- TTL set automatically on metadata and emit tracking keys
- Keys expire independently of sorted set entries
- Periodic cleanup job can remove old sorted set entries

**Postgres:**
- Optional scheduled job to DELETE old completed rows
- Or rely on table partitioning with automatic partition dropping

**File Store:**
- Periodic cleanup job filters index JSON files
- Old completed flows removed during read operations

### Benefits

- ✅ **Query completed flows without event streams**: Metadata persists longer than events
- ✅ **Historical analytics**: Track completion rates, durations over time
- ✅ **Lower storage cost**: Metadata is tiny (few KB) vs full event streams (can be MB)
- ✅ **Automatic cleanup**: No manual intervention needed
- ✅ **Configurable retention**: Different policies per environment

## Open Questions

1. **Backfill Strategy:** Should we backfill status for existing runs? No
2. **Monitoring:** How to alert on "stuck" flows?
3. **Retry limits:** Should max retries be configurable per environment?
4. **Emit data validation:** Should we validate emit payload structure?
5. **Emit data size limits:** Should we enforce max size for emit payloads?

## Related Specifications

- [v0.4 Event Schema](../v0.4/event-schema.md)
- [v0.4 Flow Scheduling](../v0.4/flow-scheduling.md)
- [v0.4 State Cleanup Strategies](../v0.4/state-cleanup-strategies.md)

## Benefits

### Horizontal Scalability
- Any instance can determine flow status without coordination
- No in-memory state required for flow completion detection
- Stateless step triggering across instances

### Proper Parallel Workflow Support
- **Multi-dependency waiting**: Steps with multiple `subscribes` wait for ALL dependencies
- **Correct synchronization**: Parallel branches properly merge before next step
- **Diamond patterns**: Common parallel workflow patterns work correctly
  ```
  Entry → ParallelA ↘
                      → FinalStep  ✅ Waits for both
  Entry → ParallelB ↗
  ```

### Improved Reliability
- **Optimistic locking prevents race conditions**: Version-based updates ensure consistent state across instances
- **Automatic conflict resolution**: Retry logic handles concurrent updates gracefully
- **No distributed locks needed**: Database-native optimistic locking eliminates complexity
- **Missing `flow.completed` events detected and emitted**: Automatic completion detection
- **Crashed instances don't leave flows in inconsistent state**: Status tracked in persistent storage
- **Step triggering resilient to event ordering issues**: Dependency checking handles any event order
- **Version conflicts are rare**: Most updates succeed on first attempt, only true conflicts retry

## Future Enhancements (v0.6+)

- Add duration tracking in metadata
- Add retry count tracking
- Add failure reason tracking
- Support custom metadata fields
- Add status transition events (running → completed)
- Optimize step trigger checking with dependency graph caching
- Add support for conditional dependencies (OR logic, not just AND)
