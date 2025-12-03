# @nvent/adapter-stream-postgres

PostgreSQL LISTEN/NOTIFY stream adapter for nvent.

## Features

- Real-time pub/sub messaging via PostgreSQL LISTEN/NOTIFY
- Gateway pattern with single dedicated connection for all subscriptions
- Automatic reconnection with channel re-subscription
- Minimal database connections (1 for listening, 1 for publishing)
- Topic listing and introspection
- Up to 8000 byte payloads per message

## Installation

```bash
pnpm add @nvent/adapter-stream-postgres
```

## Usage

Add to your `nuxt.config.ts`:

```typescript
export default defineNuxtConfig({
  modules: [
    '@nvent-addon/adapter-stream-postgres',
    'nvent'
  ],
  
  nvent: {
    connections: {
      postgres: {
        connectionString: 'postgresql://user:password@localhost:5432/myapp'
      }
    },
    
    stream: {
      adapter: 'postgres',
      prefix: 'nvent'
    }
  }
})
```

## Configuration

### Connection Options

Uses the same PostgreSQL connection config as other adapters:

```typescript
nvent: {
  connections: {
    postgres: {
      connectionString: process.env.DATABASE_URL,
      // or use individual settings:
      host: 'localhost',
      port: 5432,
      database: 'myapp',
      user: 'postgres',
      password: 'postgres',
      ssl: true
    }
  },
  
  stream: {
    adapter: 'postgres',
    prefix: 'nvent' // Channel prefix (default: 'nvent')
  }
}
```

### Advanced Configuration

```typescript
nventStreamPostgres: {
  connection: {
    // Override shared connection if needed
    connectionString: process.env.STREAM_DATABASE_URL
  },
  prefix: 'custom_prefix'
}
```

## How It Works

The adapter uses PostgreSQL's built-in pub/sub functionality:

### Channel Naming

Topics are converted to PostgreSQL channel names:
- Input: `nvent:stream:flow:events:123`
- Channel: `nvent_stream_flow_events_123` (colons → underscores)

### Gateway Pattern

**Problem:** Each subscription typically requires a dedicated database connection

**Solution:** Gateway maintains a single listening connection for all subscriptions:

```
┌─────────────────────────────────────────┐
│         PostgresListenGateway           │
│  ┌────────────────────────────────────┐ │
│  │   Single PostgreSQL Connection     │ │
│  │   (LISTEN on all channels)         │ │
│  └────────────────────────────────────┘ │
│                                          │
│  Channel Routing:                       │
│  • channel_1 → [handler1, handler2]     │
│  • channel_2 → [handler3]               │
│  • channel_3 → [handler4, handler5]     │
└─────────────────────────────────────────┘
```

### Benefits

- ✅ **Minimal connections:** Only 2 connections total (1 listen, 1 publish)
- ✅ **Automatic reconnection:** Handles connection drops gracefully
- ✅ **Channel re-subscription:** Automatically re-subscribes after reconnection
- ✅ **No external dependencies:** Uses built-in PostgreSQL features
- ✅ **Works with existing infrastructure:** No Redis or message queue required

### Limitations

- ⚠️ **8KB payload limit:** PostgreSQL NOTIFY limited to 8000 bytes
- ⚠️ **Cross-database:** LISTEN/NOTIFY doesn't work across databases
- ⚠️ **Case-insensitive channels:** PostgreSQL channel names are case-insensitive
- ⚠️ **No persistence:** Messages not delivered if no listeners

## Examples

### Publishing Events

```typescript
// Publish to a topic
await $nvent.stream.publish('flow:events', {
  type: 'flow.started',
  flowName: 'myFlow',
  runId: '123',
  data: { ... }
})
```

### Subscribing to Events

```typescript
// Subscribe to a topic
const handle = await $nvent.stream.subscribe('flow:events', (event) => {
  console.log('Received event:', event)
})

// Unsubscribe later
await $nvent.stream.unsubscribe(handle)
```

### Monitoring

```typescript
// List active topics
const topics = await $nvent.stream.listTopics()

// Get subscriber count for a topic
const count = await $nvent.stream.getSubscriptionCount('flow:events')
```

## Comparison with Redis Stream Adapter

### PostgreSQL Adapter (LISTEN/NOTIFY)
- ✅ No additional infrastructure required
- ✅ Works with existing PostgreSQL database
- ✅ Minimal connections (2 total)
- ✅ Built-in to PostgreSQL
- ⚠️ 8KB payload limit
- ⚠️ No message persistence
- ⚠️ Single database scope

### Redis Adapter (Pub/Sub)
- ✅ No payload size limits
- ✅ High throughput
- ✅ Cross-database messaging
- ⚠️ Requires Redis infrastructure
- ⚠️ More connections needed
- ⚠️ No persistence (unless configured)

## Best Practices

### Payload Size

Keep payloads under 8KB. For larger data:

```typescript
// Instead of this:
await $nvent.stream.publish('topic', {
  type: 'event',
  data: largeObject // > 8KB
})

// Do this:
await $nvent.store.set('event:123', largeObject)
await $nvent.stream.publish('topic', {
  type: 'event',
  dataKey: 'event:123' // Reference to stored data
})
```

### Connection Sharing

The adapter automatically shares the PostgreSQL connection with other adapters when using `connections.postgres`:

```typescript
nvent: {
  connections: {
    postgres: {
      connectionString: process.env.DATABASE_URL
    }
  },
  queue: {
    adapter: 'postgres' // Shares connection
  },
  stream: {
    adapter: 'postgres' // Shares connection
  },
  store: {
    adapter: 'postgres' // Shares connection
  }
}
```

### Error Handling

The gateway automatically handles connection errors and reconnects:

```typescript
// Automatic reconnection on error
// All channels are re-subscribed
// No manual intervention needed
```

## Troubleshooting

### Connection Issues

If you see connection errors:
1. Verify PostgreSQL is accessible
2. Check database credentials
3. Ensure database exists
4. Verify user has LISTEN/NOTIFY permissions

### Channel Not Receiving Messages

Check:
1. Channel name format (colons converted to underscores)
2. Both publisher and subscriber are connected
3. No firewall blocking PostgreSQL port
4. Payload under 8KB limit

### Performance

For high-throughput scenarios:
- Consider Redis adapter instead
- Monitor connection pool usage
- Check PostgreSQL logs for issues
- Tune PostgreSQL connection settings

## License

MIT
