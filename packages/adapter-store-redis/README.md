# @nvent/adapter-store-redis

Redis store adapter for nvent using Redis Streams for event storage and sorted sets for indexing.

## Features

- Event stream storage using Redis Streams (XADD/XRANGE)
- Document storage using Redis strings
- Key-value store with TTL support
- Indexing using Redis sorted sets
- Metadata tracking with optimistic locking
- Pattern-based cleanup

## Installation

```bash
pnpm add @nvent/adapter-store-redis
```

## Usage

Add to your `nuxt.config.ts`:

```typescript
export default defineNuxtConfig({
  modules: [
    'nvent',
    '@nvent/adapter-store-redis'
  ],
  
  nvent: {
    store: {
      adapter: 'redis'
    }
  },
  
  nventStoreRedis: {
    connection: {
      host: 'localhost',
      port: 6379,
      password: process.env.REDIS_PASSWORD,
      db: 0
    },
    prefix: 'nvent',
    streams: {
      trim: {
        maxLen: 10000,
        approx: true
      }
    }
  }
})
```

## Configuration

### Connection Options

- `host` - Redis host (default: 'localhost')
- `port` - Redis port (default: 6379)
- `username` - Redis username
- `password` - Redis password
- `db` - Database number (default: 0)

### Adapter Options

- `prefix` - Prefix for Redis keys (default: 'nvent')
- `streams.trim.maxLen` - Maximum stream length (default: 10000)
- `streams.trim.approx` - Use approximate trimming (default: true)

## Storage Structure

### Event Streams
```
{prefix}:stream:{name} - Redis Stream for events
```

### Documents
```
{prefix}:doc:{collection}:{id} - JSON document storage
```

### Key-Value
```
{prefix}:kv:{key} - Simple key-value pairs
```

### Indexes
```
{prefix}:idx:{key} - Sorted set for indexed entries
{prefix}:idx:{key}:meta:{id} - Hash for entry metadata
```

With the default prefix `nvent`, keys look like: `nvent:stream:myevent`, `nvent:kv:mykey`, etc.

## License

MIT
