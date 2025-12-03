# @nvent/adapter-stream-redis

Redis Pub/Sub stream adapter for nvent using ioredis.

## Features

- Real-time pub/sub messaging via Redis channels
- Multiple subscribers per topic
- Automatic channel cleanup
- Topic listing and introspection

## Installation

```bash
pnpm add @nvent/adapter-stream-redis
```

## Usage

Add to your `nuxt.config.ts`:

```typescript
export default defineNuxtConfig({
  modules: [
    'nvent',
    '@nvent/adapter-stream-redis'
  ],
  
  nvent: {
    stream: {
      adapter: 'redis'
    }
  },
  
  nventStreamRedis: {
    connection: {
      host: 'localhost',
      port: 6379,
      password: process.env.REDIS_PASSWORD,
      db: 0
    },
    prefix: 'nvent'
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

- `prefix` - Prefix for Redis channels (default: 'nvent')

## How It Works

The adapter creates Redis Pub/Sub channels for each topic:

```
{prefix}:stream:{topic}
```

With the default prefix `nvent`, channels look like: `nvent:stream:mytopic`

Messages are JSON-serialized StreamMessage objects with automatic retry and error handling.

## License

MIT
