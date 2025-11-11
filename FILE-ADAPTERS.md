# File-Based Adapters - Implementation Summary

## Overview

Created three file-based adapters that extend the memory adapters with disk persistence:

1. **FileQueueAdapter** - Queue with fastq and job persistence
2. **FileStreamAdapter** - Pub/sub with event history logging  
3. **FileStoreAdapter** - Three-tier storage with snapshot persistence

## File Queue Adapter

**Location**: `packages/nvent/src/runtime/server/adapters/builtin/file-queue.ts`

### Features
- Extends memory queue functionality with file persistence
- Uses **fastq** for job processing (same as memory adapter)
- Persists job state to individual JSON files
- Loads existing jobs on restart
- Full worker registration support with dispatcher pattern

### Storage Format
```
{dataDir}/queues/{queueName}/jobs/{jobId}.json
```

### Key Implementation Details
- Each job is stored as a separate JSON file
- Jobs are loaded from disk on `init()`
- Job state updates trigger file writes
- Worker dispatcher routes jobs by `job.name`
- Completed/failed jobs kept for debugging (optional cleanup)

### Limitations
- **Delayed jobs**: Uses `setTimeout` (not persisted across restarts)
- **Cron scheduling**: Not supported (needs scheduler daemon)
- **Single instance only**: No distributed locking

## File Stream Adapter

**Location**: `packages/nvent/src/runtime/server/adapters/builtin/file-stream.ts`

### Features
- In-memory pub/sub with EventEmitter pattern
- Optional message persistence to append-only log
- Event history replay via `readHistory()` utility method
- Same interface as memory stream adapter

### Storage Format
```
{dataDir}/streams/{topic}.ndjson
```

Each line is a JSON object:
```json
{"id":"...","ts":1234567890,"type":"...","data":{...},"metadata":{...}}
```

### Key Implementation Details
- Messages published to in-memory subscribers first
- Then appended to NDJSON file (best-effort, non-blocking)
- `readHistory()` allows reading past events with pagination
- No cross-process pub/sub (single instance only)

### Configuration
```typescript
new FileStreamAdapter({
  dataDir: '/path/to/data',
  persistMessages: true, // Default: true
})
```

## File Store Adapter

**Location**: `packages/nvent/src/runtime/server/adapters/builtin/file-store.ts`

### Features
- **Extends** `MemoryStoreAdapter` for fast in-memory access
- Adds file persistence on every write operation
- Uses **same storage format as existing file adapter** for compatibility
- Supports all three storage tiers:
  - Event streams (append-only NDJSON)
  - Documents (individual JSON files by collection)
  - KV store (individual JSON files)
  - Sorted indices (JSON arrays for flow metadata)

### Storage Format (matches existing file adapter)
```
{dataDir}/{subject}.ndjson              - Event streams
{dataDir}/indices/{key}.json            - Sorted indices  
{dataDir}/docs/{collection}/{id}.json   - Documents
{dataDir}/kv/{key}.json                 - KV store
```

**Event Stream Example**: `nq_flow_727e2491-ae36-4d64-beb9-c8f0a6d9ba56.ndjson`
```
{"type":"flow.start","runId":"...","id":"...","ts":"2025-11-07T09:25:03.686Z"}
{"type":"step.started","runId":"...","data":{...},"id":"...","ts":"..."}
```

**Index Example**: `indices/nq_flows_example-flow.json`
```json
[
  {
    "id": "727e2491-ae36-4d64-beb9-c8f0a6d9ba56",
    "score": 1762507503687,
    "status": "completed",
    "startedAt": 1762507503687,
    "completedAt": 1762507543826
  }
]
```

### Key Implementation Details
- **Event streams**: Append to NDJSON files (same as existing adapter)
- **Documents**: Individual JSON files per document (easier to inspect/edit)
- **KV store**: Individual JSON files per key (easier to debug)
- **Indices**: Full JSON array per index (same as existing adapter)
- On `init()`, loads all existing files into memory
- Composition pattern: wraps parent KV methods with file writes
- Read operations use memory (fast), writes go to both memory + disk

### Performance Considerations
- **Event stream writes**: O(1) - append to NDJSON file
- **Document writes**: O(1) - write individual JSON file
- **Index writes**: O(n) - rewrite entire index array (small n typically)
- **Reads**: O(1) - direct memory access
- **Suitable for**: Development, small-medium deployments (<100k items)
- **Not suitable for**: High-throughput production (use Redis adapters)

## Usage Examples

### File Queue

```typescript
import { FileQueueAdapter } from 'nvent/adapters'

const queue = new FileQueueAdapter({
  dataDir: './data',
})

await queue.init()

// Register worker
queue.registerWorker('myQueue', 'processTask', async (data, ctx) => {
  console.log('Processing:', data)
  return { success: true }
}, { concurrency: 5 })

// Enqueue job
const jobId = await queue.enqueue('myQueue', {
  name: 'processTask',
  data: { userId: 123 },
})
```

### File Stream

```typescript
import { FileStreamAdapter } from 'nvent/adapters'

const stream = new FileStreamAdapter({
  dataDir: './data',
  persistMessages: true,
})

await stream.init()

// Subscribe
const handle = await stream.subscribe('events', (event) => {
  console.log('Received:', event)
})

// Publish
await stream.publish('events', {
  type: 'user.created',
  data: { userId: 123 },
})

// Read history
const history = await stream.readHistory('events', {
  limit: 100,
  offset: 0,
})
```

### File Store

```typescript
import { FileStoreAdapter } from 'nvent/adapters'

const store = new FileStoreAdapter({
  dataDir: './data',
})

await store.init()

// Event stream
await store.append('nq:flow:run-123', {
  type: 'step.completed',
  data: { step: 'first' },
})

// Documents
await store.save('flows', 'myFlow', {
  name: 'myFlow',
  version: 1,
})

// KV store
await store.kv.set('counter', 42)
const value = await store.kv.increment('counter', 1) // 43

// Sorted index
await store.indexAdd('nq:flows:myFlow', 'run-123', Date.now(), {
  status: 'running',
})
```

## Exports

All file adapters are exported from the built-in adapters module:

```typescript
// packages/nvent/src/runtime/server/adapters/builtin/index.ts
export { FileQueueAdapter } from './file-queue'
export { FileStreamAdapter } from './file-stream'
export { FileStoreAdapter } from './file-store'
```

## Testing Status

- ✅ **TypeScript compilation**: All adapters compile without errors
- ✅ **Interface compliance**: Fully compatible with adapter interfaces
- ⚠️ **Runtime testing**: Not yet tested in playground
- ⚠️ **Integration testing**: Not yet tested with flows

## Next Steps

1. **Update adapter registry** to include file adapters
2. **Test in playground** with sample flows
3. **Add configuration examples** to docs
4. **Consider optimizations**:
   - FileStore: Periodic snapshots instead of per-write
   - FileStore: Write-ahead log (WAL) for durability
   - FileQueue: Job batching for better I/O performance
5. **Add cleanup utilities**:
   - Old job file removal
   - Stream log rotation
   - Snapshot compaction

## Design Decisions

### Why extend MemoryStoreAdapter?
- **Code reuse**: Inherit all logic for event streams, documents, KV, indices
- **Simplicity**: Only add persistence hooks, no need to reimplement
- **Performance**: Fast in-memory reads, acceptable write overhead for dev use

### Why snapshot-based persistence?
- **Simplicity**: Single file, easy to understand and debug
- **Consistency**: Complete state always available
- **Trade-offs**: Write amplification, not suitable for production

### Why individual job files vs. queue snapshot?
- **Incremental writes**: Only write changed jobs
- **Better for queues**: Jobs come and go frequently
- **Easier debugging**: Inspect individual jobs

### Why NDJSON for streams?
- **Append-only**: Natural fit for event streams
- **Line-based**: Easy to parse, grep, tail
- **Standard format**: Well-supported tooling

## Compatibility Matrix

| Adapter | FastQ | Optimistic Locking | Real-time Subscriptions | Cross-process |
|---------|-------|-------------------|------------------------|---------------|
| FileQueue | ✅ | N/A | N/A | ❌ |
| FileStream | N/A | N/A | ✅ (in-process) | ❌ |
| FileStore | N/A | ✅ | ✅ (in-process) | ❌ |

## File Adapter vs. Memory Adapter

| Feature | Memory | File |
|---------|--------|------|
| Persistence | ❌ | ✅ |
| Survives restart | ❌ | ✅ |
| Performance (read) | Fast | Fast |
| Performance (write) | Fast | Medium |
| Disk usage | None | Low-Medium |
| Debugging | Ephemeral | Persistent logs |
| Production ready | ❌ | ❌ (dev only) |

## Recommended Usage

- **Development**: FileQueue + FileStream + FileStore
- **Testing**: MemoryQueue + MemoryStream + MemoryStore
- **Production**: RedisQueue + RedisStream + RedisStore (separate packages)
