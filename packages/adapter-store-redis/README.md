# @nvent-addon/adapter-store-redis

Redis store adapter for nvent providing a complete three-tier storage solution using Redis Streams, Sorted Sets, and Hashes.

## Features

- **Event Stream Storage**: Redis Streams with automatic trimming (XADD/XRANGE/XREVRANGE)
- **Sorted Index Storage**: Redis Sorted Sets with metadata support via Hashes
- **Key-Value Store**: Redis strings with TTL support and atomic operations
- **Optimistic Locking**: Version-based concurrency control for index updates
- **Nested Object Support**: Automatic flattening/expansion with dot notation
- **Atomic Operations**: HINCRBY for counters with version tracking
- **Pattern-based Cleanup**: Efficient batch deletion via SCAN
- **Automatic Trimming**: Configurable stream length limits

## Installation

```bash
pnpm add @nvent-addon/adapter-store-redis ioredis
```

> **Note**: `ioredis` is a required peer dependency.

## Basic Usage

Add to your `nuxt.config.ts`:

```typescript
export default defineNuxtConfig({
  modules: [
    'nvent',
    '@nvent-addon/adapter-store-redis'
  ],
  
  nvent: {
    store: {
      adapter: 'redis',
      prefix: 'nvent'  // Optional: global prefix for all keys
    }
  },
  
  nventStoreRedis: {
    connection: {
      host: 'localhost',
      port: 6379,
      password: process.env.REDIS_PASSWORD,
      db: 0
    },
    prefix: 'nvent',  // Optional: overrides nvent.store.prefix
    streams: {
      trim: {
        maxLen: 10000,
        approx: true
      }
    }
  }
})
```

## Advanced Configuration

### Multiple Connection Sources

The adapter can pull connection settings from multiple locations (in order of precedence):

```typescript
export default defineNuxtConfig({
  nvent: {
    // Option 1: Direct store connection
    store: {
      connection: {
        host: 'redis.example.com',
        port: 6379
      }
    },
    
    // Option 2: Shared connections config
    connections: {
      redis: {
        host: 'redis.example.com',
        port: 6379,
        password: process.env.REDIS_PASSWORD
      }
    }
  },
  
  // Option 3: Module-specific connection
  nventStoreRedis: {
    connection: {
      host: 'localhost',
      port: 6379
    }
  }
})
```

## Configuration Reference

### Connection Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `host` | `string` | `'localhost'` | Redis server host |
| `port` | `number` | `6379` | Redis server port |
| `username` | `string` | - | Redis username (Redis 6+) |
| `password` | `string` | - | Redis password |
| `db` | `number` | `0` | Database number to use |

### Adapter Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `prefix` | `string` | `'nvent'` | Global prefix for all Redis keys |
| `streams.trim.maxLen` | `number` | `10000` | Maximum entries per stream before trimming |
| `streams.trim.approx` | `boolean` | `true` | Use approximate trimming (~) for better performance |

## Storage Architecture

The adapter implements a three-tier storage system:

### 1. Event Streams (Redis Streams)

Event streams store time-ordered event records using Redis Streams. Keys use the subject directly:

```
{subject} → Redis Stream
```

**Example**: `nvent:flow:abc123` stores all events for flow run `abc123`

**Operations**:
- `stream.append()` - Add event with XADD (auto-trims based on config)
- `stream.read()` - Query events with XRANGE/XREVRANGE (supports filtering, ordering, pagination)
- `stream.delete()` - Remove entire stream with DEL

**Features**:
- Automatic trimming to prevent unbounded growth
- Time-based and ID-based range queries
- Event type filtering
- Ascending/descending order support

### 2. Sorted Indexes (Redis Sorted Sets + Hashes)

Indexes provide time-ordered listings with rich metadata using two structures:

```
{key}           → Sorted Set (score-based ordering)
{key}:meta:{id} → Hash (entry metadata)
```

**Example**:
```
nvent:scheduler:trigger:flow1        → Sorted set of trigger IDs
nvent:scheduler:trigger:flow1:meta:t1 → Hash with trigger metadata
```

**Operations**:
- `index.add()` - Add to sorted set (ZADD) + store metadata (HSET)
- `index.get()` - Fetch single entry with score and metadata
- `index.read()` - Range query with pagination (ZREVRANGE + HGETALL)
- `index.update()` - Optimistic locking update with version check
- `index.updateWithRetry()` - Automatic retry on version conflicts
- `index.increment()` - Atomic field increment (HINCRBY)
- `index.delete()` - Remove from set + delete metadata

**Features**:
- Optimistic locking via version field
- Nested object support (flattened with dot notation)
- Atomic counter increments
- Exponential backoff for retries

### 3. Key-Value Store (Redis Strings)

Simple key-value storage with TTL support. Keys are used as-is without additional prefixing:

```
{key} → String value (JSON or plain text)
```

**Example**: `nvent:scheduler:lock:xyz`, `nvent:kv:config`

**Operations**:
- `kv.get()` - Retrieve value (GET, auto-parses JSON)
- `kv.set()` - Store value (SET/SETEX with optional TTL)
- `kv.delete()` - Remove key (DEL)
- `kv.clear()` - Pattern-based deletion (SCAN + DEL)
- `kv.increment()` - Atomic increment (INCRBY/HINCRBY)

**Features**:
- Automatic JSON serialization/deserialization
- TTL support for expiring keys
- Pattern-based batch deletion
- Atomic increments (supports hash fields for document counters)

## Data Structures

### Event Record

```typescript
{
  id: string         // Stream entry ID (e.g., "1234567890-0")
  ts: number        // Timestamp
  type: string      // Event type
  runId?: string    // Flow run ID
  flowName?: string // Flow name
  stepName?: string // Step name
  stepId?: string   // Step instance ID
  attempt?: number  // Retry attempt
  data?: any        // Event payload
}
```

### Index Entry

```typescript
{
  id: string                    // Entry identifier
  score: number                 // Sort score (typically timestamp)
  metadata?: {                  // Optional metadata
    version: number             // Auto-managed for optimistic locking
    [key: string]: any         // User-defined fields (supports nesting)
  }
}
```

## Examples

### Working with Event Streams

```typescript
// Append event to stream
await store.stream.append('nvent:flow:run123', {
  type: 'flow:started',
  flowName: 'my-flow',
  runId: 'run123',
  data: { input: 'test' }
})

// Read recent events
const events = await store.stream.read('nvent:flow:run123', {
  limit: 50,
  order: 'desc',
  types: ['flow:started', 'flow:completed']
})

// Read events in time range
const events = await store.stream.read('nvent:flow:run123', {
  from: Date.now() - 3600000,  // Last hour
  to: Date.now(),
  limit: 100
})
```

### Working with Indexes

```typescript
// Add indexed entry with metadata
await store.index.add(
  'nvent:scheduler:trigger:flow1',
  'trigger-123',
  Date.now(),
  {
    cron: '0 * * * *',
    enabled: true,
    stats: {
      totalFires: 0,
      lastFire: null
    }
  }
)

// Update with optimistic locking
const success = await store.index.update(
  'nvent:scheduler:trigger:flow1',
  'trigger-123',
  { enabled: false }
)

// Update with automatic retry on conflict
await store.index.updateWithRetry(
  'nvent:scheduler:trigger:flow1',
  'trigger-123',
  { 'stats.totalFires': 5 }
)

// Atomic increment
await store.index.increment(
  'nvent:scheduler:trigger:flow1',
  'trigger-123',
  'stats.totalFires',
  1
)

// List entries (newest first)
const entries = await store.index.read(
  'nvent:scheduler:trigger:flow1',
  { offset: 0, limit: 50 }
)
```

### Working with Key-Value Store

```typescript
// Set with TTL
await store.kv.set('nvent:scheduler:lock:flow1', { owner: 'worker-1' }, 60)

// Get value
const lock = await store.kv.get('nvent:scheduler:lock:flow1')

// Increment counter
const count = await store.kv.increment('nvent:counter:processed', 1)

// Clear by pattern
const deleted = await store.kv.clear('nvent:temp:*')
```

## Performance Considerations

- **Approximate Trimming**: Enable `streams.trim.approx` for better performance (uses `~` in MAXLEN)
- **Batch Operations**: The adapter uses pipelining internally for metadata operations
- **Connection Pooling**: IORedis handles connection pooling automatically
- **Optimistic Locking**: Reduces contention compared to pessimistic locks
- **Lazy Connection**: Connection is established on first operation

## Migration Notes

When upgrading from previous versions, note:

1. **Key Structure**: Stream keys now use subjects directly (no additional prefixing)
2. **Metadata Storage**: Index metadata moved from embedded JSON to separate hashes
3. **Version Fields**: All index entries now include a `version` field for optimistic locking

## License

MIT
