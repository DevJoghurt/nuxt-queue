# Store + Stream Adapter Integration

## Overview

Implemented **Option A**: StoreAdapter has StreamAdapter as constructor dependency for automatic cross-instance replication.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Application Code                        │
│  (FlowWiring, Workers, API Endpoints)                       │
└────────────────────┬────────────────────────────────────────┘
                     │ calls append/save/delete/kv.set
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                   StoreAdapter                              │
│  (append, save, delete, kv.set, indexAdd)                  │
└────────────────────┬────────────────────────────────────────┘
                     │ automatically publishes to
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                  StreamAdapter                              │
│  (publish, subscribe - cross-instance pub/sub)             │
└────────────────────┬────────────────────────────────────────┘
                     │ replicates to
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              All Other Instances                            │
│  (Subscribe to StreamAdapter for cross-instance updates)   │
└─────────────────────────────────────────────────────────────┘
```

## Implementation

### StreamAdapter Types

- **MemoryStreamAdapter**: In-memory pub/sub (single instance)
- **RedisStreamAdapter**: Redis Pub/Sub (multi-instance) - TODO
- **No FileStreamAdapter**: File deployments use MemoryStreamAdapter (single instance)

### 1. StoreAdapter accepts optional StreamAdapter

**MemoryStoreAdapter** and **FileStoreAdapter** both accept StreamAdapter in constructor:

```typescript
export interface MemoryStoreAdapterOptions {
  streamAdapter?: StreamAdapter
}

export class MemoryStoreAdapter implements StoreAdapter {
  private stream?: StreamAdapter
  
  constructor(opts?: MemoryStoreAdapterOptions) {
    this.stream = opts?.streamAdapter
  }
}
```

**FileStoreAdapter** extends the options:

```typescript
export interface FileStoreAdapterOptions extends MemoryStoreAdapterOptions {
  dataDir: string
}

export class FileStoreAdapter extends MemoryStoreAdapter {
  constructor(options: FileStoreAdapterOptions) {
    super(options) // Pass streamAdapter to parent
  }
}
```

### 2. Storage Operations Automatically Publish

Every mutation operation publishes to StreamAdapter if available:

#### append()
```typescript
async append(subject: string, event: Omit<EventRecord, 'id' | 'ts'>): Promise<EventRecord> {
  // ... store event ...
  
  // Publish to StreamAdapter for cross-instance replication
  if (this.stream) {
    await this.stream.publish(`store:append:${subject}`, {
      type: 'store.append',
      data: { subject, event: eventRecord },
      timestamp: Date.now(),
    })
  }
  
  return eventRecord
}
```

#### save()
```typescript
async save(collection: string, id: string, doc: Record<string, any>): Promise<void> {
  // ... save document ...
  
  if (this.stream) {
    await this.stream.publish(`store:save:${collection}`, {
      type: 'store.save',
      data: { collection, id, doc },
      timestamp: Date.now(),
    })
  }
}
```

#### delete()
```typescript
async delete(collection: string, id: string): Promise<void> {
  // ... delete document ...
  
  if (this.stream) {
    await this.stream.publish(`store:delete:${collection}`, {
      type: 'store.delete',
      data: { collection, id },
      timestamp: Date.now(),
    })
  }
}
```

#### kv.set()
```typescript
kv = {
  set: async <T = any>(key: string, value: T, _ttl?: number): Promise<void> => {
    // ... set value ...
    
    if (this.stream) {
      await this.stream.publish(`store:kv:${key}`, {
        type: 'store.kv.set',
        data: { key, value },
        timestamp: Date.now(),
      })
    }
  }
}
```

#### kv.delete()
```typescript
delete: async (key: string): Promise<void> => {
  // ... delete key ...
  
  if (this.stream) {
    await this.stream.publish(`store:kv:${key}`, {
      type: 'store.kv.delete',
      data: { key },
      timestamp: Date.now(),
    })
  }
}
```

#### indexAdd()
```typescript
async indexAdd(key: string, id: string, score: number, metadata?: Record<string, any>): Promise<void> {
  // ... add to index ...
  
  if (this.stream) {
    await this.stream.publish(`store:index:${key}`, {
      type: 'store.index.add',
      data: { key, id, score, metadata },
      timestamp: Date.now(),
    })
  }
}
```

### 3. Factory Function

Created `adapters/factory.ts` with `createAdapters()` that properly wires dependencies:

```typescript
export async function createAdapters(config: AdapterConfig): Promise<AdapterSet> {
  // 1. Create StreamAdapter first (no dependencies)
  const stream = await createStreamAdapter(config.stream)

  // 2. Create StoreAdapter with StreamAdapter dependency
  const store = await createStoreAdapter(config.store, stream)

  // 3. Create QueueAdapter (independent)
  const queue = await createQueueAdapter(config.queue)

  return { queue, stream, store }
}
```

**Key insight**: StreamAdapter is created first, then passed to StoreAdapter constructor.

## Benefits

1. **Automatic Replication**: All storage writes automatically replicate to other instances
2. **No Manual Streaming**: New features just call StoreAdapter - streaming happens automatically
3. **Clean Separation**: Storage layer (StoreAdapter) and replication layer (StreamAdapter) are separate
4. **Optional Streaming**: File/Memory adapters work without StreamAdapter (single-instance)
5. **v0.4 Compatible Pattern**: Matches Redis adapter's XADD + PUBLISH pattern

## Topic Naming Convention

Stream topics follow this pattern:

- `store:append:{subject}` - Event stream appends
- `store:save:{collection}` - Document saves
- `store:delete:{collection}` - Document deletes
- `store:kv:{key}` - KV operations
- `store:index:{key}` - Index operations

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

## Migration Path

### Current State (v0.4)

```typescript
// Old EventStoreAdapter (single interface)
const adapter = createRedisAdapter()
await adapter.append(stream, event)
// Redis adapter internally does: XADD + PUBLISH
```

### New State (Monorepo Refactoring)

```typescript
// New three-adapter architecture
const adapters = await createAdapters(config)
await adapters.store.append(stream, event)
// StoreAdapter internally publishes to StreamAdapter
```

## WebSocket Integration

**Current (v0.4)**: WebSocket uses `store.subscribe()` for in-process updates only

**Future**: WebSocket should subscribe to StreamAdapter for cross-instance updates

```typescript
// OLD (v0.4 EventStoreAdapter)
const unsub = store.subscribe(flowStream, (event) => {
  peer.send({ type: 'event', event })
})

// NEW (StreamAdapter for cross-instance)
const handle = await stream.subscribe(`store:append:${flowStream}`, (streamEvent) => {
  peer.send({ type: 'event', event: streamEvent.data.event })
})
```

## Next Steps

1. ✅ **DONE**: Memory and File store adapters accept StreamAdapter
2. ✅ **DONE**: All mutation operations publish to StreamAdapter
3. ✅ **DONE**: Factory function creates adapters with proper dependencies
4. ⏳ **TODO**: Create Redis adapters with StreamAdapter integration
5. ⏳ **TODO**: Update WebSocket handler to subscribe via StreamAdapter
6. ⏳ **TODO**: Update FlowWiring to use new adapter architecture
7. ⏳ **TODO**: Deprecate old EventStoreAdapter system

## Compatibility

- **Memory adapters**: Work with or without StreamAdapter (single-instance default)
- **File adapters**: Work with or without StreamAdapter (single-instance default)
- **Redis adapters**: MUST use StreamAdapter for cross-instance replication
- **v0.4 code**: Still works via old EventStoreAdapter (parallel implementation)
- **Migration**: Gradual - can run both systems side-by-side

## Testing

### Single Instance (File/Memory)
```typescript
const adapters = await createAdapters({
  store: { type: 'file', options: { dataDir: '.data' } },
  stream: { type: 'file' }, // Uses MemoryStreamAdapter internally
  queue: { type: 'file', options: { dataDir: '.data' } },
})
// File config automatically uses MemoryStreamAdapter
// Works fine - no cross-instance needed
```

### Multi-Instance (Redis with StreamAdapter)
```typescript
const adapters = await createAdapters({
  store: { type: 'redis', options: { host: 'localhost' } },
  stream: { type: 'redis', options: { host: 'localhost' } },
})
// Store writes automatically replicate across instances
```

---

**Status**: ✅ Core implementation complete  
**Branch**: monorepo-refactoring  
**Date**: 2025-11-08
