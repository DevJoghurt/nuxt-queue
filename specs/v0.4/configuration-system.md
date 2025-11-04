# Configuration System - v0.4

Complete guide to configuring queues and workers in nuxt-queue v0.4.

## Overview

The configuration system in v0.4 allows developers to configure queues and workers at two levels:

1. **Global defaults** via `nuxt.config.ts` - Applied to all queues and workers
2. **Per-queue overrides** via `defineQueueConfig()` - Applied to specific workers

The system uses a priority-based merge strategy where per-queue configurations override global defaults.

### Store Shortcut

v0.4 includes a convenient `store` shortcut that configures all backends (queue, state, eventStore) to use the same storage backend:

```typescript
queue: {
  store: {
    name: 'redis',
    redis: { host: '127.0.0.1', port: 6379 }
  }
}
```

Individual backends can still override this shortcut.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      nuxt.config.ts                         │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ queue.defaultConfig (Global Defaults)                │  │
│  │  - Queue options (prefix, defaultJobOptions, etc.)   │  │
│  │  - Worker options (queue.defaultConfig.worker)       │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼ (Registry Build Time)
                       Config Merger
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   server/queues/*.ts                        │
│  ┌──────────────────────┐                                  │
│  │ defineQueueConfig()  │                                  │
│  │ (Per-Queue Override) │                                  │
│  └──────────────────────┘                                  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼ (Merged Config)
                    Runtime Application
                            │
        ┌───────────────────┴───────────────────┐
        ▼                                       ▼
  Queue Provider                         Worker Runner
  (BullMQ/PGBoss)                       (Node/Task)
```

## Configuration Options

### Queue Configuration

Queue configuration controls how jobs are enqueued and managed.

```typescript
interface QueueConfig {
  name?: string
  defaultJobOptions?: QueueJobDefaults
  prefix?: string
  limiter?: {
    max?: number
    duration?: number
    groupKey?: string
  }
}
```

#### QueueJobDefaults

```typescript
interface QueueJobDefaults {
  // Number of retry attempts for failed jobs
  // BullMQ: attempts, PGBoss: retryLimit
  attempts?: number

  // Backoff strategy for retries
  // BullMQ: backoff, PGBoss: retryBackoff + exponentialBackoff
  backoff?: number | { type: 'fixed' | 'exponential', delay: number }

  // Delay in milliseconds before the job is processed
  // BullMQ: delay, PGBoss: startAfter
  delay?: number

  // Job priority (higher number = higher priority)
  // BullMQ: priority, PGBoss: priority
  priority?: number

  // Job timeout in milliseconds
  // BullMQ: timeout, PGBoss: expireInSeconds (converted)
  timeout?: number

  // Process jobs in LIFO (Last In First Out) order
  // BullMQ: lifo, PGBoss: not supported
  lifo?: boolean

  // Remove job from queue when completed
  // BullMQ: removeOnComplete, PGBoss: deleteAfterSeconds
  removeOnComplete?: boolean | number

  // Remove job from queue when failed
  // BullMQ: removeOnFail, PGBoss: deleteAfterSeconds
  removeOnFail?: boolean | number

  // Repeatable job configuration
  // BullMQ: repeat, PGBoss: schedule pattern
  repeat?: {
    cron?: string
    every?: number
    limit?: number
    tz?: string
  }
}
```

### Worker Configuration

Worker configuration controls how workers process jobs.

```typescript
interface WorkerConfig {
  // Number of jobs to process concurrently
  // BullMQ: concurrency, PGBoss: teamSize
  concurrency?: number

  // Lock duration in milliseconds
  // BullMQ: lockDuration, PGBoss: newJobCheckInterval (similar concept)
  lockDurationMs?: number

  // Maximum number of times a job can be stalled before being failed
  // BullMQ: maxStalledCount, PGBoss: not directly supported
  maxStalledCount?: number

  // Delay in milliseconds before processing jobs after queue is drained
  // BullMQ: drainDelay, PGBoss: not directly supported
  drainDelayMs?: number

  // Automatically run worker on startup
  // BullMQ: autorun, PGBoss: workers start automatically
  autorun?: boolean

  // Polling interval in milliseconds for checking new jobs
  // PGBoss: newJobCheckInterval, BullMQ: uses blocking wait
  pollingIntervalMs?: number
}
```

## Global Configuration

Configure defaults for all queues and workers in `nuxt.config.ts`:

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['nuxt-queue'],
  
  queue: {
    // Option 1: Use the store shortcut (recommended)
    store: {
      name: 'redis', // or 'postgres'
      redis: {
        host: '127.0.0.1',
        port: 6379,
      },
    },
    
    // Option 2: Configure individual backends
    // queue: {
    //   name: 'redis',
    //   redis: { host: '127.0.0.1', port: 6379 },
    // },
    // state: {
    //   name: 'redis',
    //   redis: { host: '127.0.0.1', port: 6379 },
    // },
    // eventStore: {
    //   name: 'redis',
    //   redis: { host: '127.0.0.1', port: 6379 },
    // },
    
    // Global queue and worker configuration
    queue: {
      defaultConfig: {
        // Queue options
        prefix: 'nq',
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
          removeOnComplete: 100,
          removeOnFail: 50,
        },
        limiter: {
          max: 100,
          duration: 60000, // 1 minute
        },
        
        // Worker options (nested under worker key)
        worker: {
          concurrency: 2,
          lockDurationMs: 30000, // 30 seconds
          maxStalledCount: 1,
          autorun: true,
        },
      },
    },
  },
})
```

## Per-Queue Configuration

Override global defaults for specific queues using `defineQueueConfig()`:

```typescript
// server/queues/my-queue/handler.ts
export const config = defineQueueConfig({
  queue: {
    name: 'my_custom_queue',
    prefix: 'custom',
    defaultJobOptions: {
      attempts: 5, // Override: more retries
      backoff: {
        type: 'exponential',
        delay: 2000, // Override: longer delay
      },
      priority: 10,
    },
    limiter: {
      max: 10, // Override: stricter rate limit
      duration: 60000,
    },
  },
  
  worker: {
    concurrency: 5, // Override: more concurrent jobs
    lockDurationMs: 60000, // Override: longer lock
  },
  
  flow: {
    name: ['my-flow'],
    role: 'entry',
    step: 'start',
    emits: ['work.ready'],
  },
})

export default defineQueueWorker(async (job, ctx) => {
  // Your worker logic
})
```

## Configuration Priority

The configuration system uses a priority-based merge strategy:

1. **Per-queue config** (highest priority) - from `defineQueueConfig()`
2. **Global defaults** (lowest priority) - from `nuxt.config.ts`

```typescript
// Example merge result:
// nuxt.config.ts
queue: {
  defaultConfig: {
    worker: {
      concurrency: 2,
      lockDurationMs: 30000,
    }
  }
}

// server/queues/my-queue.ts
defineQueueConfig({
  worker: {
    concurrency: 5, // Overrides global
    // lockDurationMs: 30000 (inherited from global)
  }
})

// Final merged config for this queue:
{
  worker: {
    concurrency: 5,        // From defineQueueConfig
    lockDurationMs: 30000, // From queue.defaultConfig.worker
  }
}
```

## Provider Compatibility

All configuration options are designed to be compatible with both BullMQ and PGBoss providers.

### BullMQ Mapping

```typescript
// Queue Config
{
  prefix: 'nq',              → Queue({ prefix: 'nq' })
  defaultJobOptions: {...},  → Queue({ defaultJobOptions: {...} })
  limiter: {                 → Queue({ limiter: {
    max: 10,                      max: 10,
    duration: 60000,              duration: 60000,
    groupKey: 'key',              groupKey: 'key'
  }                              }})
}

// Worker Config
{
  concurrency: 5,            → Worker({ concurrency: 5 })
  lockDurationMs: 30000,     → Worker({ lockDuration: 30000 })
  maxStalledCount: 1,        → Worker({ maxStalledCount: 1 })
  drainDelayMs: 100,         → Worker({ drainDelay: 100 })
  autorun: true,             → Worker({ autorun: true })
}
```

### PGBoss Mapping (Future)

```typescript
// Queue Config
{
  prefix: 'nq',              → PgBoss({ schema: 'nq' })
  limiter: {                 → (partial support)
    max: 10,                      teamSize: 10
  }
}

// Worker Config
{
  concurrency: 5,            → work({ teamSize: 5 })
  pollingIntervalMs: 5000,   → work({ newJobCheckInterval: 5000 })
}
```

## Configuration in UI

The queue management UI displays configuration for each queue:

### Queue List View

The queue list shows a summary of custom configurations:

```
┌──────────────────────────────────────────────────────────┐
│ Queue Name   │ Config                      │ Waiting │...│
├──────────────────────────────────────────────────────────┤
│ example      │ • Concurrency: 5           │   12    │...│
│              │ • Limiter: 10/60000ms      │         │   │
├──────────────────────────────────────────────────────────┤
│ background   │ Default                    │    3    │...│
└──────────────────────────────────────────────────────────┘
```

### Configuration API

The `/api/_queues` endpoint includes configuration:

```typescript
GET /api/_queues

Response:
[
  {
    "name": "example",
    "counts": { "waiting": 12, "active": 2, ... },
    "isPaused": false,
    "config": {
      "queue": {
        "prefix": "custom",
        "defaultJobOptions": {
          "attempts": 5,
          "backoff": { "type": "exponential", "delay": 2000 }
        },
        "limiter": {
          "max": 10,
          "duration": 60000
        }
      },
      "worker": {
        "concurrency": 5,
        "lockDurationMs": 60000,
        "maxStalledCount": 1
      }
    }
  }
]
```

## Best Practices

### 1. Use the Store Shortcut for Simplicity

```typescript
// nuxt.config.ts
queue: {
  store: {
    name: 'redis',
    redis: { host: '127.0.0.1', port: 6379 },
  },
  queue: {
    defaultConfig: {
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 100, // Keep last 100 completed jobs
        removeOnFail: 50,      // Keep last 50 failed jobs
      },
    },
  },
}
```

### 2. Override Only What's Necessary

```typescript
// server/queues/high-priority.ts
export const config = defineQueueConfig({
  queue: {
    defaultJobOptions: {
      priority: 10, // Only override priority
    },
  },
  // Inherits all other defaults from nuxt.config.ts
})
```

### 3. Use Rate Limiting for Resource-Intensive Tasks

```typescript
export const config = defineQueueConfig({
  queue: {
    limiter: {
      max: 5,           // Max 5 jobs
      duration: 60000,  // per minute
    },
  },
})
```

### 4. Adjust Concurrency Based on Job Type

```typescript
// For CPU-intensive tasks
export const config = defineQueueConfig({
  worker: {
    concurrency: 1, // Process one at a time
  },
})

// For I/O-bound tasks
export const config = defineQueueConfig({
  worker: {
    concurrency: 10, // Process many in parallel
  },
})
```

### 5. Set Appropriate Timeouts

```typescript
export const config = defineQueueConfig({
  queue: {
    defaultJobOptions: {
      timeout: 300000, // 5 minutes
    },
  },
  worker: {
    lockDurationMs: 360000, // Longer than timeout
  },
})
```

## Examples

### Example 1: High-Priority Queue with Strict Rate Limiting

```typescript
// server/queues/notifications/send_email.ts
export const config = defineQueueConfig({
  queue: {
    name: 'notifications',
    defaultJobOptions: {
      priority: 10,
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 1000,
    },
    limiter: {
      max: 100,        // Max 100 emails
      duration: 60000, // per minute
    },
  },
  worker: {
    concurrency: 10,
  },
})

export default defineQueueWorker(async (job, ctx) => {
  await sendEmail(job.data)
})
```

### Example 2: Background Processing with Low Priority

```typescript
// server/queues/background/cleanup.ts
export const config = defineQueueConfig({
  queue: {
    name: 'background',
    defaultJobOptions: {
      priority: 1, // Low priority
      attempts: 1, // Don't retry
      removeOnComplete: true,
    },
  },
  worker: {
    concurrency: 1, // Process one at a time
  },
})

export default defineQueueWorker(async (job, ctx) => {
  await cleanupOldData()
})
```

### Example 3: Long-Running Tasks

```typescript
// server/queues/reports/generate.ts
export const config = defineQueueConfig({
  queue: {
    name: 'reports',
    defaultJobOptions: {
      timeout: 1800000, // 30 minutes
      attempts: 2,
      removeOnComplete: 50,
    },
  },
  worker: {
    concurrency: 2,
    lockDurationMs: 2100000, // 35 minutes (longer than timeout)
  },
})

export default defineQueueWorker(async (job, ctx) => {
  await generateLargeReport(job.data)
})
```

## Migration from v0.3

In v0.3, configuration was passed directly to BullMQ. In v0.4, use the provider-agnostic configuration:

```typescript
// v0.3 (BullMQ-specific)
export const config = {
  bullmq: {
    queue: {
      defaultJobOptions: { attempts: 3 },
    },
    worker: {
      concurrency: 5,
    },
  },
}

// v0.4 (Provider-agnostic)
export const config = defineQueueConfig({
  queue: {
    defaultJobOptions: { attempts: 3 },
  },
  worker: {
    concurrency: 5,
  },
})
```

### Global Config Migration

```typescript

// v0.4
export default defineNuxtConfig({
  queue: {
    store: {
      name: 'redis',
      redis: {
        host: '127.0.0.1',
        port: 6379,
      },
    },
  },
})
```

## Troubleshooting

### Configuration Not Applied

1. **Check configuration syntax**:
   ```typescript
   // ❌ Wrong
   export const config = {
     concurrency: 5,
   }

   // ✅ Correct
   export const config = defineQueueConfig({
     worker: { concurrency: 5 },
   })
   ```

2. **Verify registry compilation**:
   ```bash
   # Check if config is in registry
   curl http://localhost:3000/api/_queues
   ```

3. **Check runtime config**:
   ```typescript
   // In server code
   const config = useRuntimeConfig()
   console.log(config.queue.queue.defaultConfig.worker)
   ```

### Rate Limiting Not Working

Ensure both `max` and `duration` are set:

```typescript
limiter: {
  max: 10,
  duration: 60000, // Required
}
```

### Configuration Changes Not Reflected

In development, the registry is rebuilt automatically. In production:

1. Rebuild the application
2. Restart the server

## Store Shortcut Configuration

The `store` shortcut provides a convenient way to configure all backends at once:

### Basic Usage

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  queue: {
    store: {
      name: 'redis',
      redis: {
        host: '127.0.0.1',
        port: 6379,
      },
    },
  },
})
```

This automatically configures:
- `queue.name` = 'redis' with `queue.redis` config
- `state.name` = 'redis' with `state.redis` config  
- `eventStore.name` = 'redis' with `eventStore.redis` config

### With Overrides

Individual backends can override the shortcut:

```typescript
export default defineNuxtConfig({
  queue: {
    store: {
      name: 'redis',
      redis: { host: '127.0.0.1', port: 6379 },
    },
    
    // Override: use memory for eventStore in development
    eventStore: {
      name: 'memory',
    },
  },
})
```

### PostgreSQL Example

```typescript
export default defineNuxtConfig({
  queue: {
    store: {
      name: 'postgres',
      postgres: {
        connectionString: 'postgresql://localhost:5432/myapp',
      },
    },
  },
})
```

## Related Documentation

- **[Current Implementation](./current-implementation.md)** - Full v0.4 architecture
- **[Quick Reference](./quick-reference.md)** - API reference
- **[Worker Development](./current-implementation.md#worker-development)** - Worker patterns

---

**Version**: v0.4.0  
**Last Updated**: 2025-11-04  
**Status**: ✅ Current Implementation
