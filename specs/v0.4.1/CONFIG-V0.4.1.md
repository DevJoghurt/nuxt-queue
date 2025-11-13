# Configuration System v0.4.1

## Overview

The v0.4.1 configuration system introduces a **flat, clean structure** for the three-adapter architecture (Queue, Stream, Store) with connection fallback support.

**Breaking Change**: No backwards compatibility with v0.4.0 nested config structures.

## Configuration Structure

### Top-Level Config

```typescript
export default defineNuxtConfig({
  modules: ['@nvent/nuxt'],
  nvent: {
    // Directory to scan for queues
    dir: 'queues',
    
    // Enable dev UI
    ui: true,
    
    // Shared connection configurations (fallback for all adapters)
    connections: {
      redis: {
        host: '127.0.0.1',
        port: 6379,
      },
      postgres: {
        connectionString: 'postgresql://localhost:5432/mydb',
      },
      rabbitmq: {
        host: 'localhost',
        port: 5672,
      },
      kafka: {
        brokers: ['localhost:9092'],
      },
      file: {
        dataDir: '.data', // Base directory for file adapters
      },
    },
    
    // Queue adapter configuration
    queue: {
      adapter: 'memory',
      // ... queue options
    },
    
    // Stream adapter configuration
    stream: {
      adapter: 'memory',
      // ... stream options
    },
    
    // Store adapter configuration
    store: {
      adapter: 'memory',
      // ... store options
    },
  },
})
```

## Connection Fallback Pattern

Each adapter config can specify its own connection, which **overrides** the shared connection from `connections.*`.

**Supported shared connections:**
- `connections.redis` → Used by queue/stream/store adapters
- `connections.postgres` → Used by queue/store adapters
- `connections.rabbitmq` → Used by stream adapter
- `connections.kafka` → Used by stream adapter
- `connections.file` → Used by queue/store file adapters (sets base dataDir)

```typescript
nvent: {
  // Shared connections (fallback for all adapters)
  connections: {
    redis: {
      host: 'shared-redis.example.com',
      port: 6379,
    },
    file: {
      dataDir: '.data', // Base directory
    },
  },
  
  // Queue uses shared Redis
  queue: {
    adapter: 'redis',
    // redis not specified → uses connections.redis
  },
  
  // Stream uses different Redis instance
  stream: {
    adapter: 'redis',
    redis: {
      host: 'stream-redis.example.com',
      port: 6380,
    }, // ✅ overrides connections.redis
  },
  
  // Store uses file adapter with shared file config
  store: {
    adapter: 'file',
    // file not specified → uses connections.file with '/store' subdirectory
    // Result: { dataDir: '.data/store' }
  },
}
```

## Queue Configuration

```typescript
queue: {
  // Adapter type
  adapter?: 'memory' | 'file' | 'redis' | 'postgres'
  // @default 'file'
  
  // Connection overrides
  redis?: RedisConfig
  postgres?: PostgresConfig
  file?: FileConfig // e.g., { dataDir: '.data/queue' }
  
  // Queue options
  prefix?: string // e.g., 'nq'
  defaultJobOptions?: JobOptions
  limiter?: {
    max?: number
    duration?: number
    groupKey?: string
  }
  
  // Worker configuration
  worker?: {
    concurrency?: number // default: 2
    autorun?: boolean // default: true
    lockDurationMs?: number
    maxStalledCount?: number
    drainDelayMs?: number
    pollingIntervalMs?: number // default: 1000 (for file adapter)
  }
}
```

**Example: Redis Queue**
```typescript
queue: {
  adapter: 'redis',
  redis: {
    host: 'queue-redis.example.com',
    port: 6379,
    password: 'secret',
  },
  prefix: 'nq',
  worker: {
    concurrency: 4,
    autorun: true,
  },
}
```

**Example: File Queue**
```typescript
queue: {
  adapter: 'file',
  file: {
    dataDir: '.data/queue',
  },
  worker: {
    concurrency: 2,
    pollingIntervalMs: 1000,
  },
}
```

## Stream Configuration

```typescript
stream: {
  // Adapter type
  adapter?: 'memory' | 'redis' | 'rabbitmq' | 'kafka'
  
  // Connection overrides
  redis?: RedisConfig
  postgres?: PostgresConfig
  
  // RabbitMQ
  rabbitmq?: {
    url?: string
    host?: string
    port?: number
    username?: string
    password?: string
    vhost?: string
  }
  
  // Kafka
  kafka?: {
    brokers?: string[]
    clientId?: string
    groupId?: string
  }
  
  // Stream options (all at top level)
  prefix?: string
  retryAttempts?: number
  retryDelay?: number
}
```

**Example: Redis Stream**
```typescript
stream: {
  adapter: 'redis',
  // Uses connections.redis (fallback)
  prefix: 'nq:stream',
}
```

**Example: RabbitMQ Stream**
```typescript
stream: {
  adapter: 'rabbitmq',
  rabbitmq: {
    url: 'amqp://localhost',
    vhost: '/nvent',
  },
}
```

## Store Configuration

```typescript
store: {
  // Adapter type
  adapter?: 'memory' | 'file' | 'redis' | 'postgres'
  // @default 'file'
  
  // Connection overrides
  redis?: RedisConfig
  postgres?: PostgresConfig
  file?: FileConfig // e.g., { dataDir: '.data/store' }
  
  // Store options (all at top level)
  prefix?: string // Key prefix/namespace, default: 'nq'
  
  // State management configuration (KV store behavior)
  state?: {
    autoScope?: 'always' | 'flow' | 'never' // default: 'always'
    cleanup?: {
      strategy?: 'never' | 'immediate' | 'on-complete' | 'ttl'
      ttlMs?: number // default: 3600000 (1 hour)
    }
  }
  
  // TTL settings (seconds)
  eventTTL?: number // default: 604800 (7 days)
  metadataTTL?: number // default: 2592000 (30 days)
  kvTTL?: number
  indexTTL?: number
  
  // Features
  compression?: boolean
}
```

### State Management Options

Nested under `store.state`, these options control KV store behavior (from v0.4.0 StateConfig):

**`state.autoScope`**: Controls automatic flow ID assignment for state operations
- `'always'` (default): Always create a new flow ID for state scoping
- `'flow'`: Only use flow ID if provided in context
- `'never'`: Never scope state to flow IDs

**`state.cleanup.strategy`**: Controls when state is cleaned up
- `'never'` (default): State persists indefinitely
- `'immediate'`: Cleanup after each step (not recommended)
- `'on-complete'`: Cleanup when flow completes (recommended for production)
- `'ttl'`: Automatic expiration via TTL

**`state.cleanup.ttlMs`**: Time-to-live in milliseconds for 'ttl' strategy (default: 3600000 = 1 hour)

**Example: File Store with State Cleanup**
```typescript
store: {
  adapter: 'file',
  file: {
    dataDir: '.data/store',
  },
  state: {
    autoScope: 'always', // Always scope state to flows
    cleanup: {
      strategy: 'on-complete', // Clean up when flow completes
    },
  },
  eventTTL: 86400, // 1 day
}
```

**Example: Postgres Store**
```typescript
store: {
  adapter: 'postgres',
  postgres: {
    connectionString: process.env.DATABASE_URL,
  },
  prefix: 'nvent',
  eventTTL: 604800,
  compression: true,
}
```

## Common Patterns

### Development (File, Default)
```typescript
nvent: {
  // Uses defaults: file queue, memory stream, file store
  // No configuration needed!
}
```

### Development (Memory, Fast - No Persistence)
```typescript
nvent: {
  queue: { adapter: 'memory' },
  stream: { adapter: 'memory' },
  store: { adapter: 'memory' },
}
```

### Single Instance (File, Persistent - Default)
```typescript
nvent: {
  // This is the default configuration
  queue: { adapter: 'file', dataDir: '.data/queue' },
  stream: { adapter: 'memory' }, // No persistence needed for pub/sub
  store: { adapter: 'file', dataDir: '.data/store' },
}
```

### Multi-Instance (Redis, Distributed)
```typescript
nvent: {
  connections: {
    redis: {
      host: 'redis.example.com',
      port: 6379,
    },
  },
  queue: { adapter: 'redis' },
  stream: { adapter: 'redis' },
  store: { adapter: 'redis' },
}
```

### Production (Postgres Store, Redis Queue/Stream)
```typescript
nvent: {
  connections: {
    redis: {
      host: 'redis.example.com',
      port: 6379,
    },
    postgres: {
      connectionString: process.env.DATABASE_URL,
    },
  },
  queue: { adapter: 'redis' }, // Uses connections.redis
  stream: { adapter: 'redis' }, // Uses connections.redis
  store: { adapter: 'postgres' }, // Uses connections.postgres
}
```

### Production (Kafka Stream, File Store)
```typescript
nvent: {
  connections: {
    kafka: {
      brokers: ['kafka1.example.com:9092', 'kafka2.example.com:9092'],
      clientId: 'nvent',
    },
    file: {
      dataDir: '/var/lib/nvent',
    },
  },
  queue: { 
    adapter: 'file', 
    // file.dataDir becomes: /var/lib/nvent/queue
  },
  stream: { 
    adapter: 'kafka', 
    // Uses connections.kafka
  },
  store: { 
    adapter: 'file',
    // file.dataDir becomes: /var/lib/nvent/store
  },
}
```

## Migration from v0.4.0

### Old Structure (v0.4.0)
```typescript
nvent: {
  queue: {
    adapter: 'redis',
    defaultConfig: {              // ❌ Nested
      prefix: 'nq',
      worker: {                   // ❌ Deeply nested
        concurrency: 2,
        autorun: true,
      },
    },
    redis: { ... },
  },
  state: {                        // ❌ Separate config
    adapter: 'redis',
    namespace: 'nq',
    autoScope: 'always',
    cleanup: {
      strategy: 'on-complete',
    },
    redis: { ... },               // ❌ Duplicate connection
  },
  eventStore: {                   // ❌ Separate config
    adapter: 'redis',
    redis: { ... },               // ❌ Duplicate connection
  },
}
```

### New Structure (v0.4.1)
```typescript
nvent: {
  connections: {                  // ✅ Shared connections (fallback)
    redis: { ... },
  },
  queue: {
    adapter: 'redis',             // ✅ or 'file' (default)
    prefix: 'nq',                 // ✅ Direct
    worker: {                     // ✅ Grouped logically
      concurrency: 2,
      autorun: true,
    },
  },
  stream: {
    adapter: 'redis',             // ✅ or 'memory' (default)
    // Uses connections.redis (fallback)
  },
  store: {
    adapter: 'redis',             // ✅ or 'file' (default)
    prefix: 'nq',                 // ✅ Merged from state.namespace
    state: {                      // ✅ Grouped logically
      autoScope: 'always',        // ✅ From state config
      cleanup: {                  // ✅ From state config
        strategy: 'on-complete',
      },
    },
  },
}
```

## Key Changes

1. **Organized Structure**: Related options grouped under logical keys
   - `queue.worker.*` for worker-specific options (concurrency, autorun, etc.)
   - `store.state.*` for state management options (autoScope, cleanup)
2. **Three Adapters**: `queue`, `stream`, `store` (no more `state` or `eventStore`)
3. **Connection Fallback**: `connections.redis/postgres` as shared defaults
4. **Adapter Override**: Each adapter can specify its own `redis`/`postgres`
5. **Universal Connections**: All adapters support connection overrides (file, redis, postgres, kafka, rabbitmq)
6. **Default Adapters**: Queue=`file`, Stream=`memory`, Store=`file` (better for single-instance)
7. **No Backwards Compatibility**: Clean break from v0.4.0

## TypeScript Interfaces

```typescript
export interface ModuleOptions {
  dir?: string
  ui?: boolean
  debug?: Record<string, any>
  connections?: ConnectionsConfig
  queue?: QueueConfig
  stream?: StreamConfig
  store?: StoreConfig
}

export interface ConnectionsConfig {
  redis?: RedisConfig
  postgres?: PostgresConfig
  rabbitmq?: RabbitMQConfig
  kafka?: KafkaConfig
  file?: FileConfig
}

export interface WorkerConfig {
  concurrency?: number
  autorun?: boolean
  lockDurationMs?: number
  maxStalledCount?: number
  drainDelayMs?: number
  pollingIntervalMs?: number
}

export interface QueueConfig {
  adapter?: 'memory' | 'file' | 'redis' | 'postgres'
  redis?: RedisConfig
  postgres?: PostgresConfig
  file?: FileConfig
  prefix?: string
  defaultJobOptions?: Record<string, any>
  worker?: WorkerConfig
  // ... adapter-specific options
}

export interface StreamConfig {
  adapter?: 'memory' | 'redis' | 'rabbitmq' | 'kafka'
  redis?: RedisConfig
  postgres?: PostgresConfig
  rabbitmq?: RabbitMQConfig
  kafka?: KafkaConfig
  prefix?: string
  // ... adapter-specific options
}

export interface StateManagementConfig {
  autoScope?: 'always' | 'flow' | 'never'
  cleanup?: {
    strategy?: 'never' | 'immediate' | 'on-complete' | 'ttl'
    ttlMs?: number
  }
}

export interface StoreConfig {
  adapter?: 'memory' | 'file' | 'redis' | 'postgres'
  redis?: RedisConfig
  postgres?: PostgresConfig
  file?: FileConfig
  prefix?: string
  state?: StateManagementConfig
  eventTTL?: number
  metadataTTL?: number
  // ... adapter-specific options
}
```

## Normalization Logic

The `normalizeModuleOptions()` function:

1. Merges user config with defaults
2. Applies connection fallback for each adapter:
   - If `queue.redis` not specified → use `connections.redis`
   - If `stream.postgres` not specified → use `connections.postgres`
   - etc.

```typescript
// Example: Queue inherits shared Redis
normalizeModuleOptions({
  connections: { redis: { host: 'redis.example.com' } },
  queue: { adapter: 'redis' }, // No redis specified
})

// Result:
{
  connections: { redis: { host: 'redis.example.com' } },
  queue: {
    adapter: 'redis',
    redis: { host: 'redis.example.com' }, // Inherited
  },
}
```

## Implementation Files

- `packages/nvent/src/config/types.ts` - TypeScript interfaces
- `packages/nvent/src/config/index.ts` - Normalization logic
- `packages/nvent/src/runtime/server/plugins/00.adapters.ts` - Runtime initialization

## Next Steps

- Update `00.adapters.ts` plugin to use new config structure
- Create Redis adapters (Queue, Stream, Store)
- Test configuration in playground
- Update documentation
