# v0.4.1 Specification: Monorepo & Adapter System Refactoring

**Version:** 0.4.1  
**Date:** November 7, 2025  
**Project Rename:** `nuxt-queue` → `nvent`  
**Status:** Draft

## Overview

This specification outlines the architectural transformation from a single-package project (`nuxt-queue`) to a monorepo structure (`nvent`) with a modular adapter system. The goal is to create a clean, extensible architecture where core functionality is separated from infrastructure adapters, enabling users to choose the right backend for their needs.

## Project Rename: nuxt-queue → nvent

**Rationale:**
- "nvent" represents **N**uxt **Event**-driven workflows
- Shorter, more memorable name
- Better represents the event-driven nature of the system
- Avoids confusion with simple queue libraries

**Migration:**
- All package names will use `@nvent/*` scope
- NPM package: `nvent` (main module)
- GitHub repo: remains `nuxt-queue` (for continuity) or renamed to `nvent`
- Documentation URLs will reference `nvent`

---

## Monorepo Structure

```
nvent/
├── packages/
│   ├── nvent/                        # Core module (formerly nuxt-queue)
│   ├── adapter-queue-redis/          # BullMQ adapter
│   ├── adapter-queue-postgres/       # PGBoss adapter (future)
│   ├── adapter-stream-redis/         # Redis Streams for pub/sub
│   ├── adapter-stream-rabbitmq/      # RabbitMQ adapter (future)
│   ├── adapter-store-redis/          # Redis for flow wiring/triggers
│   └── adapter-store-postgres/       # Postgres store (future)
├── playground/                        # Test application
├── docs/                             # Documentation site
├── package.json                      # Root workspace config
├── pnpm-workspace.yaml              # Workspace definition
└── README.md
```

### Package Naming Convention

```
@nvent/nvent                    # Core module
@nvent/adapter-queue-redis      # Queue adapter for Redis
@nvent/adapter-stream-redis     # Stream adapter for Redis
@nvent/adapter-store-redis      # Store adapter for Redis
```

---

## Adapter System Architecture

### Three Adapter Types

#### 1. **Queue Adapters** (`adapter-queue-*`)

**Purpose:** Task queue and worker execution  
**Current Implementation:** BullMQ (Redis)  
**Responsibility:**
- Job enqueueing and scheduling
- Worker process management
- Job retry logic
- Concurrency control

**Interface:**
```typescript
export interface QueueAdapter {
  // Initialize connection
  init(): Promise<void>
  
  // Enqueue job
  enqueue(queue: string, job: JobInput): Promise<string>
  
  // Schedule job with delay or cron
  schedule(queue: string, job: JobInput, opts?: ScheduleOptions): Promise<string>
  
  // Job queries
  getJob(queue: string, id: string): Promise<Job | null>
  getJobs(queue: string, q?: JobsQuery): Promise<Job[]>
  getJobCounts(queue: string): Promise<JobCounts>
  
  // Queue control
  pause(queue: string): Promise<void>
  resume(queue: string): Promise<void>
  isPaused(queue: string): Promise<boolean>
  
  // Event handling
  on(queue: string, event: QueueEvent, cb: (p: any) => void): () => void
  
  // Cleanup
  close(): Promise<void>
}
```

**Built-in Implementations:**
- `memory`: In-memory queue (dev/testing)
- `file`: File-based queue (simple persistence)

**External Adapters:**
- `@nvent/adapter-queue-redis`: BullMQ implementation
- `@nvent/adapter-queue-postgres`: PGBoss implementation (future)

---

#### 2. **Stream Adapters** (`adapter-stream-*`)

**Purpose:** External event streaming and pub/sub messaging for cross-instance communication  
**Current Implementation:** Part of EventStoreAdapter (Redis Pub/Sub, file watching, memory events)  
**Distinction from Event Bus:** 
- **Event Bus** (stays as-is): Internal, in-process pub/sub using Node.js EventEmitter for flow coordination
- **Stream Adapter** (new): External pub/sub for cross-instance messaging, broadcasting, and real-time subscriptions

**Responsibility:**
- Publishing events to external systems
- Subscribing to event topics across instances
- Message routing between different server instances
- Real-time event notifications (used by EventStoreAdapter's subscribe)
- Broadcasting to clients (future: WebSocket)

**Current Usage:** EventStoreAdapter's `subscribe()` method currently uses:
- Redis: Pub/Sub channels (`nq:events:*`)
- Memory: In-memory event listeners
- File: File system watching (chokidar)

**Interface:**
```typescript
export interface StreamAdapter {
  // Initialize connection
  init(): Promise<void>
  
  // Publish event to topic (cross-instance)
  publish(topic: string, event: StreamEvent): Promise<void>
  
  // Subscribe to topic (cross-instance real-time)
  subscribe(
    topic: string, 
    handler: (event: StreamEvent) => void | Promise<void>,
    opts?: SubscribeOptions
  ): Promise<SubscriptionHandle>
  
  // Unsubscribe
  unsubscribe(handle: SubscriptionHandle): Promise<void>
  
  // Topic management
  listTopics(): Promise<string[]>
  getSubscriptionCount(topic: string): Promise<number>
  
  // Cleanup
  shutdown(): Promise<void>
}

export interface StreamEvent<T = any> {
  topic: string
  data: T
  timestamp?: number
  runId?: string
  // Can be a message ID from Redis Pub/Sub, file path, etc.
  id?: string
}

export interface SubscriptionHandle {
  topic: string
  id: string
  unsubscribe: () => Promise<void>
}
```

**Relationship with EventStoreAdapter:**
The `EventStoreAdapter.subscribe()` method will internally use `StreamAdapter` for real-time notifications:

```typescript
// In StoreAdapter implementation
async subscribe(subject: string, onEvent: (e: EventRecord) => void): Promise<EventSubscription> {
  const stream = subject
  const channel = `nq:events:${subject}`
  
  // Use stream adapter for pub/sub
  const handle = await streamAdapter.subscribe(channel, async (msg) => {
    // Fetch full event from store using msg.id
    const events = await this.read(stream, { fromId: msg.id, limit: 1 })
    if (events[0]) {
      onEvent(events[0])
    }
  })
  
  return {
    unsubscribe() {
      handle.unsubscribe()
    }
  }
}
```

**Built-in Implementations:**
- `memory`: In-memory pub/sub (single instance)
- `file`: File-based event log (simple persistence)

**External Adapters:**
- `@nvent/adapter-stream-redis`: Redis Streams
- `@nvent/adapter-stream-rabbitmq`: RabbitMQ (future)
- `@nvent/adapter-stream-kafka`: Apache Kafka (future)

**Note:** The name "stream" represents the pub/sub nature of this adapter for cross-instance communication. 

**Architecture:**
```
┌─────────────────────────────────────────────────────────┐
│                    Application Code                      │
└───────────────────┬─────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
        ▼                       ▼
┌──────────────┐      ┌──────────────────┐
│  Event Bus   │      │  Store Adapter   │
│  (Internal)  │      │   (Persistent)   │
│              │      │                  │
│ - Node.js    │      │ - append()       │
│   EventEmit  │      │ - read()         │
│ - In-process │      │ - subscribe()────┼──► Uses StreamAdapter
│ - Flow coord │      │ - indexAdd()     │    for real-time
└──────────────┘      └──────────────────┘
                                │
                                ▼
                      ┌──────────────────┐
                      │ Stream Adapter   │
                      │  (Pub/Sub)       │
                      │                  │
                      │ - publish()      │
                      │ - subscribe()    │
                      │ - Cross-instance │
                      └──────────────────┘
```

Alternative names considered:
- `messaging` - too generic
- `pubsub` - accurate but less standard
- `events` - conflicts with event store
- `stream` - aligns with event streaming concepts (Redis Streams Pub/Sub, Kafka, etc.)

---

#### 3. **Store Adapters** (`adapter-store-*`)

**Purpose:** Unified persistent storage layer  
**Current Name:** Event Store + State (will merge)  

**Three Storage Paradigms:**
1. **Event Stream:** Append-only log for flow execution history (immutable events)
2. **Document Store:** Structured data with versioning (flow wiring, triggers, metadata)
3. **Key-Value Store:** Simple ephemeral state (caching, temporary data, coordination)

**Why Simplified?**
The v0.4.0 interface had many similar methods (`indexAdd`, `indexGet`, `indexUpdate`, `indexIncrement`, `indexRead`, `saveFlowWiring`, `getTrigger`, `getState`, `setState`) that all did similar things: store and retrieve structured data. The new interface reduces this to three clear patterns:
- `append/read/subscribe` for immutable event streams
- `save/get/list/delete` for documents (replaces index* and specific wiring/trigger methods)
- `kv.get/set/delete/clear` for simple key-value storage (replaces state methods)

**Interface:**
```typescript
export interface StoreAdapter {
  // Connection management
  close(): Promise<void>
  
  // 1. Event Stream Operations (append-only log for flow execution history)
  append(subject: string, event: Omit<EventRecord, 'id' | 'ts'>): Promise<EventRecord>
  read(subject: string, opts?: EventReadOptions): Promise<EventRecord[]>
  subscribe(subject: string, onEvent: (e: EventRecord) => void): Promise<EventSubscription>
  
  // 2. Document Store (structured data with versioning)
  //    Used for: Flow wiring, triggers, flow metadata
  //    Replaces: indexAdd/indexGet/indexUpdate/indexIncrement/indexRead
  save(collection: string, id: string, doc: Record<string, any>): Promise<void>
  get(collection: string, id: string): Promise<Record<string, any> | null>
  list(collection: string, opts?: ListOptions): Promise<Array<{ id: string; doc: Record<string, any> }>>
  delete(collection: string, id: string): Promise<void>
  
  // 3. Key-Value Store (simple ephemeral state)
  //    Used for: Temporary state, caching, coordination
  kv: {
    get<T>(key: string): Promise<T | null>
    set<T>(key: string, value: T, ttl?: number): Promise<void>
    delete(key: string): Promise<void>
    clear(pattern: string): Promise<number>
  }
}

// Core types
export interface EventRecord {
  id: string
  ts: number
  type: string
  runId: string
  flowName: string
  stepName?: string
  stepId?: string
  attempt?: number
  data?: any
}

export interface EventReadOptions {
  fromId?: string
  limit?: number
  direction?: 'forward' | 'backward'
}

export interface EventSubscription {
  unsubscribe(): void
}

export interface ListOptions {
  limit?: number
  offset?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

// Document schemas (application-level, not adapter interface)
export interface FlowWiring {
  steps: Record<string, StepDefinition>
  connections: Array<{ from: string; to: string; condition?: string }>
  version: number
  updatedAt: number
}

export interface StepDefinition {
  name: string
  handler: string
  config?: Record<string, any>
  retry?: { attempts: number; backoff: number }
}

export interface TriggerDefinition {
  type: 'schedule' | 'event' | 'manual'
  config: Record<string, any>
}

export interface FlowMetadata {
  runId: string
  status: 'running' | 'completed' | 'failed'
  startedAt: number
  completedAt?: number
  stepCount: number
  completedSteps: number
  version: number
}
```

**Built-in Implementations:**
- `memory`: In-memory storage (dev/testing)
- `file`: File-based storage (simple persistence)

**External Adapters:**
- `@nvent/adapter-store-redis`: Redis for event store + state
- `@nvent/adapter-store-postgres`: PostgreSQL (future)

**Note:** This adapter merges the current `eventStore` and `state` concepts into a **unified three-tier storage system**:

1. **Event Stream** (append-only) - Flow execution history, audit log
2. **Document Store** (structured) - Flow wiring, triggers, metadata (replaces current in-memory registry)
3. **Key-Value** (ephemeral) - Temporary state, caching

**Benefits of Simplification:**
- **Fewer methods:** 11 methods instead of 20+ (45% reduction)
- **Clear patterns:** Each storage type has obvious use cases
- **Easier implementation:** Document store = single CRUD pattern for all structured data
- **Better composability:** Applications build schemas on top of simple `save/get/list`
- **Unified versioning:** All documents use same optimistic locking strategy

**Migration from v0.4.0:**
- `indexAdd/indexGet/indexUpdate/indexIncrement/indexRead` → `save/get/list` in document store
- `saveFlowWiring/getFlowWiring/listFlows` → `save/get/list` in `flows` collection
- `saveTrigger/getTrigger/listTriggers` → `save/get/list` in `triggers` collection  
- `getState/setState/deleteState/clearNamespace` → `kv.get/set/delete/clear`
- Flow metadata (runtime tracking) → `save/get/list` in `flow-runs` collection

The `subscribe()` method internally delegates to `StreamAdapter` for real-time pub/sub, while maintaining the persistent event log.

**Implementation Detail:**
```typescript
class RedisStoreAdapter implements StoreAdapter {
  constructor(
    private redis: RedisClient,
    private streamAdapter: StreamAdapter  // Injected
  ) {}
  
  // Event Stream: Redis Streams (XADD, XRANGE)
  async append(subject: string, event: EventRecord): Promise<EventRecord> {
    const id = await this.redis.xadd(subject, '*', ...fields)
    await this.streamAdapter.publish(`nq:events:${subject}`, { id, subject })
    return { ...event, id }
  }
  
  async subscribe(subject: string, onEvent): Promise<EventSubscription> {
    const handle = await this.streamAdapter.subscribe(
      `nq:events:${subject}`,
      async (msg) => {
        const events = await this.read(subject, { fromId: msg.id, limit: 1 })
        if (events[0]) onEvent(events[0])
      }
    )
    return { unsubscribe: () => handle.unsubscribe() }
  }
  
  // Document Store: Redis Hashes with versioning
  async save(collection: string, id: string, doc: Record<string, any>): Promise<void> {
    const key = `nq:doc:${collection}:${id}`
    const version = doc._version || 0
    
    // Optimistic locking with Lua script
    const script = `
      local current = redis.call('HGET', KEYS[1], '_version')
      if current == ARGV[1] or not current then
        for i = 2, #ARGV, 2 do
          redis.call('HSET', KEYS[1], ARGV[i], ARGV[i + 1])
        end
        redis.call('HSET', KEYS[1], '_version', tonumber(ARGV[1]) + 1)
        return 1
      else
        return 0
      end
    `
    await this.redis.eval(script, 1, key, version, ...Object.entries(doc).flat())
  }
  
  async get(collection: string, id: string): Promise<Record<string, any> | null> {
    const key = `nq:doc:${collection}:${id}`
    const data = await this.redis.hgetall(key)
    return Object.keys(data).length > 0 ? data : null
  }
  
  async list(collection: string, opts?: ListOptions): Promise<Array<{ id: string; doc: any }>> {
    const pattern = `nq:doc:${collection}:*`
    const keys = await this.scanKeys(pattern)
    
    const results = []
    for (const key of keys.slice(opts?.offset || 0, opts?.limit || 100)) {
      const id = key.split(':').pop()!
      const doc = await this.get(collection, id)
      if (doc) results.push({ id, doc })
    }
    return results
  }
  
  // Key-Value: Simple Redis GET/SET
  kv = {
    get: async <T>(key: string): Promise<T | null> => {
      const val = await this.redis.get(`nq:kv:${key}`)
      return val ? JSON.parse(val) : null
    },
    set: async <T>(key: string, value: T, ttl?: number): Promise<void> => {
      const str = JSON.stringify(value)
      if (ttl) {
        await this.redis.setex(`nq:kv:${key}`, ttl, str)
      } else {
        await this.redis.set(`nq:kv:${key}`, str)
      }
    },
    delete: async (key: string): Promise<void> => {
      await this.redis.del(`nq:kv:${key}`)
    },
    clear: async (pattern: string): Promise<number> => {
      const keys = await this.scanKeys(`nq:kv:${pattern}`)
      if (keys.length > 0) await this.redis.del(...keys)
      return keys.length
    }
  }
}

// Application-level usage examples
const store = useStoreAdapter()

// Flow wiring (document store)
await store.save('flows', 'my-flow', {
  steps: { ... },
  connections: [ ... ],
  version: 1,
  updatedAt: Date.now()
})

// Trigger (document store)
await store.save('triggers', 'my-flow', {
  type: 'schedule',
  config: { cron: '0 * * * *' }
})

// Flow metadata (document store with sortable IDs)
await store.save('flow-runs', 'run-123', {
  status: 'running',
  startedAt: Date.now(),
  stepCount: 5,
  completedSteps: 2,
  version: 1
})

// Temporary state (key-value)
await store.kv.set('flow:run-123:temp-data', { foo: 'bar' }, 3600)
```

---

## Adapter Integration Pattern

### Nuxt Module Registration

Each external adapter is a standalone Nuxt module that integrates via Nuxt hooks.

**Example: `@nvent/adapter-queue-redis`**

```typescript
// packages/adapter-queue-redis/src/module.ts
import { defineNuxtModule } from '@nuxt/kit'
import { RedisQueueAdapter } from './adapter'

export default defineNuxtModule({
  meta: {
    name: '@nvent/adapter-queue-redis'
  },
  
  setup(options, nuxt) {
    // Register adapter via Nuxt hook
    // Adapter will receive config from nvent.queue.redis
    nuxt.hook('nvent:registerAdapter', (registry, config) => {
      const redisConfig = config.queue?.redis
      if (redisConfig) {
        const adapter = new RedisQueueAdapter(redisConfig)
        registry.registerQueue('redis', adapter)
      }
    })
  }
})
```

**Core Module Adapter Resolution:**

```typescript
// packages/nvent/src/runtime/server/adapters/factory.ts
export class AdapterRegistry {
  private queueAdapters = new Map<string, QueueAdapter>()
  private streamAdapters = new Map<string, StreamAdapter>()
  private storeAdapters = new Map<string, StoreAdapter>()
  
  registerQueue(name: string, adapter: QueueAdapter) {
    this.queueAdapters.set(name, adapter)
  }
  
  registerStream(name: string, adapter: StreamAdapter) {
    this.streamAdapters.set(name, adapter)
  }
  
  registerStore(name: string, adapter: StoreAdapter) {
    this.storeAdapters.set(name, adapter)
  }
  
  getQueue(name: string): QueueAdapter {
    return this.queueAdapters.get(name) 
      || this.getBuiltInQueue(name)
  }
  
  private getBuiltInQueue(name: string): QueueAdapter {
    if (name === 'memory') return new MemoryQueueAdapter()
    if (name === 'file') return new FileQueueAdapter()
    throw new Error(`Unknown queue adapter: ${name}`)
  }
  
  // Similar for stream and store...
}
```

### Configuration

**User Configuration:**

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: [
    'nvent',
    '@nvent/adapter-queue-redis',
    '@nvent/adapter-stream-redis',
    '@nvent/adapter-store-redis'
  ],
  
  nvent: {
    queue: {
      adapter: 'redis',  // Resolves to registered adapter
      redis: {
        host: 'localhost',
        port: 6379
      },
      defaultConfig: {
        attempts: 3,
        backoff: 1000
      }
    },
    stream: {
      adapter: 'redis',
      redis: {
        host: 'localhost',
        port: 6379
      }
    },
    store: {
      adapter: 'redis',
      redis: {
        host: 'localhost',
        port: 6379
      },
      retention: {
        eventTTL: 604800,  // 7 days
        metadataTTL: 2592000  // 30 days
      }
    }
  }
})
```

---

## Configuration System Refactoring

### Current State (v0.4.0)

```typescript
// src/config/types.ts
export interface ModuleOptions {
  dir?: string
  ui?: boolean
  debug?: Record<string, any>
  
  store?: StoreShortcut  // Shortcut to set all backends
  queue?: QueueConfig
  state?: StateConfig
  eventStore?: EventStoreConfig
}
```

### New State (v0.4.1)

```typescript
// packages/nvent/src/config/types.ts
export interface ModuleOptions {
  dir?: string
  ui?: boolean
  debug?: Record<string, any>
  
  // Three adapter types
  queue?: QueueAdapterConfig
  stream?: StreamAdapterConfig
  store?: StoreAdapterConfig
}

export interface QueueAdapterConfig {
  adapter: string  // 'memory' | 'file' | 'redis' | 'postgres' | custom
  redis?: RedisConfig
  postgres?: PostgresConfig
  defaultConfig?: {
    prefix?: string
    attempts?: number
    backoff?: number
    worker?: {
      concurrency?: number
      autorun?: boolean
    }
  }
}

export interface StreamAdapterConfig {
  adapter: string  // 'memory' | 'file' | 'redis' | 'rabbitmq' | custom
  redis?: RedisConfig
  rabbitmq?: RabbitMQConfig
  options?: Record<string, any>
}

export interface StoreAdapterConfig {
  adapter: string  // 'memory' | 'file' | 'redis' | 'postgres' | custom
  redis?: RedisConfig
  postgres?: PostgresConfig
  retention?: {
    eventTTL?: number
    metadataTTL?: number
  }
  namespace?: string
  options?: Record<string, any>
}

export interface RedisConfig {
  host?: string
  port?: number
  username?: string
  password?: string
  db?: number
  url?: string
}

export interface PostgresConfig {
  connectionString?: string
  host?: string
  port?: number
  database?: string
  user?: string
  password?: string
}

export interface RabbitMQConfig {
  url?: string
  host?: string
  port?: number
  username?: string
  password?: string
  vhost?: string
}
```

---

## Migration from Motia Pattern

The Motia project provides excellent reference implementation for the adapter pattern. Key takeaways:

### 1. **Interface-First Design**
- Define clear interfaces in core package
- Adapters implement interfaces, not extend classes
- Type-safe adapter contracts

### 2. **Default Implementations**
- Include memory/file adapters in core
- No external dependencies for basic usage
- Easy testing and development

### 3. **Adapter Registration**
- Adapters register via framework hooks
- Core discovers and initializes adapters
- Clean separation of concerns

### 4. **Configuration Pattern**
```typescript
// Motia's pattern
export default config({
  adapters: {
    streams: new MyStreamAdapter('name'),
    state: new MyStateAdapter(),
    events: new MyEventAdapter(),
    cron: new MyCronAdapter()
  }
})
```

### 5. **Package Structure**
```
packages/
  adapter-rabbitmq-events/     # Standalone package
    ├── src/
    │   ├── index.ts            # Exports adapter
    │   ├── adapter.ts          # Implementation
    │   └── types.ts            # Type definitions
    ├── package.json
    └── README.md
```

### Differences from Motia

1. **Nuxt-specific:** We use Nuxt module system, not standalone config
2. **Three types:** We have queue/stream/store vs Motia's events/state/cron/streams
3. **Runtime discovery:** Adapters register via `nvent:registerAdapter` hook
4. **Configuration:** Nuxt config vs `motia.config.ts`

---

## Implementation Phases

### Phase 1: Core Restructuring
- [ ] Set up monorepo with pnpm workspaces
- [ ] Rename main package to `nvent`
- [ ] Create adapter interfaces (QueueAdapter, StreamAdapter, StoreAdapter)
- [ ] Implement built-in adapters (memory, file)
- [ ] Create AdapterRegistry system
- [ ] Add `nvent:registerAdapter` hook

### Phase 2: External Adapters
- [ ] Extract BullMQ to `@nvent/adapter-queue-redis`
- [ ] Extract Redis Streams to `@nvent/adapter-stream-redis`
- [ ] Extract event store to `@nvent/adapter-store-redis`
- [ ] Create Nuxt modules for each adapter
- [ ] Implement adapter registration hooks

### Phase 3: Configuration System
- [ ] Refactor config types to new structure
- [ ] Update runtime config resolution
- [ ] Migrate playground to new config
- [ ] Add config validation

### Phase 4: Documentation & Testing
- [ ] Write adapter development guide
- [ ] Add integration tests for all adapters
- [ ] Update README and docs
- [ ] Create example projects
- [ ] Write deployment guides

---

## Directory Structure (Detailed)

```
nvent/
├── packages/
│   ├── nvent/                                    # Core module
│   │   ├── src/
│   │   │   ├── module.ts                        # Main Nuxt module
│   │   │   ├── config/
│   │   │   │   ├── index.ts
│   │   │   │   └── types.ts
│   │   │   ├── registry/                        # Flow registry (unchanged)
│   │   │   ├── runtime/
│   │   │   │   ├── server/
│   │   │   │   │   ├── adapters/
│   │   │   │   │   │   ├── factory.ts           # AdapterRegistry
│   │   │   │   │   │   ├── interfaces/
│   │   │   │   │   │   │   ├── queue.ts
│   │   │   │   │   │   │   ├── stream.ts
│   │   │   │   │   │   │   └── store.ts
│   │   │   │   │   │   └── builtin/
│   │   │   │   │   │       ├── memory-queue.ts
│   │   │   │   │   │       ├── file-queue.ts
│   │   │   │   │   │       ├── memory-stream.ts
│   │   │   │   │   │       ├── file-stream.ts
│   │   │   │   │   │       ├── memory-store.ts
│   │   │   │   │   │       └── file-store.ts
│   │   │   │   │   ├── queue/                   # Queue orchestration
│   │   │   │   │   ├── worker/                  # Worker execution
│   │   │   │   │   └── utils/
│   │   │   │   └── app/                         # UI components
│   │   │   └── utils/
│   │   ├── package.json
│   │   └── README.md
│   │
│   ├── adapter-queue-redis/
│   │   ├── src/
│   │   │   ├── module.ts                        # Nuxt module
│   │   │   ├── adapter.ts                       # BullMQ implementation
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── README.md
│   │
│   ├── adapter-stream-redis/
│   │   ├── src/
│   │   │   ├── module.ts
│   │   │   ├── adapter.ts                       # Redis Streams implementation
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── README.md
│   │
│   └── adapter-store-redis/
│       ├── src/
│       │   ├── module.ts
│       │   ├── adapter.ts                       # Redis store implementation
│       │   ├── types.ts
│       │   └── index.ts
│       ├── package.json
│       └── README.md
│
├── playground/                                   # Test application
├── docs/                                         # Documentation
├── package.json                                  # Root workspace
├── pnpm-workspace.yaml
├── tsconfig.json
└── README.md
```

---

---

## Benefits of This Architecture

### 1. **Clear Separation of Concerns**
- Core logic separate from infrastructure
- Easier to test and maintain
- Swap implementations without code changes

### 2. **Developer Experience**
- Start with memory adapters (zero config)
- Add Redis/Postgres when needed
- Custom adapters for specialized needs

### 3. **Scalability**
- Use appropriate backend for each concern
- Queue on Redis, store on Postgres
- Horizontal scaling with external adapters

### 4. **Extensibility**
- Community can create adapters
- Support for any backend
- No core changes needed for new adapters

### 5. **Type Safety**
- Full TypeScript support
- Interface contracts enforced
- IDE autocomplete for all adapters

---

## Testing Strategy

### Unit Tests
- Each adapter interface has test suite
- Mock implementations for testing
- Verify all methods work correctly

### Integration Tests
- Test adapter registration
- Verify Nuxt module integration
- End-to-end flows with real adapters

### Adapter Tests
- Test each built-in adapter implementation
- Verify adapter interface compliance
- Test adapter lifecycle (init/close)

---

## Documentation Needed

1. **Getting Started Guide:** Zero to production with nvent
2. **Adapter Development Guide:** How to create custom adapters
3. **Configuration Reference:** Complete config structure
4. **Architecture Overview:** Explain three adapter types
5. **Deployment Guide:** Production setup with external adapters
6. **API Reference:** Complete interface documentation

---

## Design Decisions

1. **State merge into Store:** ✅ Merge into store adapter for simplicity
   - Both handle persistent data, unified interface is cleaner

2. **Stream naming:** ✅ "Stream" for pub/sub adapters
   - Aligns with event streaming concepts (Redis Streams, Kafka)
   - Avoids confusion with queue/events terminology

3. **No backwards compatibility:** ✅ Clean break in v0.4.1
   - Fresh start with better architecture
   - Simpler codebase without legacy support

4. **Built-in vs External:** ✅ Memory and file built-in, others external
   - Zero dependencies for development
   - Easy testing without external services
   - Production users install needed adapters

---

## Next Steps

1. Review this specification with stakeholders
2. Create proof-of-concept for adapter registration
3. Design detailed API for each interface
4. Set up monorepo structure
5. Begin Phase 1 implementation

---

## References

- **Motia Adapter PR:** https://github.com/MotiaDev/motia/pull/868
- **BullMQ Docs:** https://docs.bullmq.io/
- **Redis Streams:** https://redis.io/docs/data-types/streams/
- **Nuxt Module Guide:** https://nuxt.com/docs/guide/going-further/modules

---

## Appendix A: Interface Definitions (Complete)

### QueueAdapter Interface

```typescript
export interface QueueAdapter {
  // Lifecycle
  init(): Promise<void>
  close(): Promise<void>
  
  // Job operations
  enqueue(queue: string, job: JobInput): Promise<string>
  schedule(queue: string, job: JobInput, opts?: ScheduleOptions): Promise<string>
  getJob(queue: string, id: string): Promise<Job | null>
  getJobs(queue: string, query?: JobsQuery): Promise<Job[]>
  getJobCounts(queue: string): Promise<JobCounts>
  
  // Queue control
  pause(queue: string): Promise<void>
  resume(queue: string): Promise<void>
  isPaused(queue: string): Promise<boolean>
  
  // Events
  on(queue: string, event: QueueEvent, callback: (payload: any) => void): () => void
}

export interface JobInput {
  name: string
  data: any
  opts?: {
    attempts?: number
    backoff?: number
    delay?: number
    priority?: number
  }
}

export interface Job {
  id: string
  name: string
  data: any
  state?: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'paused'
  returnvalue?: any
  failedReason?: string
  timestamp?: number
  processedOn?: number
  finishedOn?: number
}

export interface ScheduleOptions {
  delay?: number
  cron?: string
}

export interface JobsQuery {
  state?: Array<Job['state']>
  limit?: number
  cursor?: string
}

export interface JobCounts {
  active: number
  completed: number
  failed: number
  delayed: number
  waiting: number
  paused: number
}

export type QueueEvent = 
  | 'added' 
  | 'waiting' 
  | 'active' 
  | 'progress' 
  | 'completed' 
  | 'failed' 
  | 'paused' 
  | 'resumed'
```

### StreamAdapter Interface

```typescript
export interface StreamAdapter {
  // Lifecycle
  init(): Promise<void>
  shutdown(): Promise<void>
  
  // Messaging
  publish(topic: string, event: StreamEvent): Promise<void>
  subscribe(
    topic: string,
    handler: (event: StreamEvent) => void | Promise<void>,
    opts?: SubscribeOptions
  ): Promise<SubscriptionHandle>
  unsubscribe(handle: SubscriptionHandle): Promise<void>
  
  // Management
  listTopics(): Promise<string[]>
  getSubscriptionCount(topic: string): Promise<number>
}

export interface StreamEvent<T = any> {
  topic: string
  data: T
  timestamp?: number
  runId?: string
  flowName?: string
  metadata?: Record<string, any>
}

export interface SubscribeOptions {
  queue?: string
  exclusive?: boolean
  durable?: boolean
  prefetch?: number
}

export interface SubscriptionHandle {
  topic: string
  id: string
  unsubscribe: () => Promise<void>
}
```

### StoreAdapter Interface

```typescript
export interface StoreAdapter {
  // Lifecycle
  close(): Promise<void>
  
  // 1. Event Stream (append-only log)
  append(subject: string, event: Omit<EventRecord, 'id' | 'ts'>): Promise<EventRecord>
  read(subject: string, opts?: EventReadOptions): Promise<EventRecord[]>
  subscribe(subject: string, onEvent: (e: EventRecord) => void): Promise<EventSubscription>
  
  // 2. Document Store (structured data with versioning)
  save(collection: string, id: string, doc: Record<string, any>): Promise<void>
  get(collection: string, id: string): Promise<Record<string, any> | null>
  list(collection: string, opts?: ListOptions): Promise<Array<{ id: string; doc: Record<string, any> }>>
  delete(collection: string, id: string): Promise<void>
  
  // 3. Key-Value Store (simple ephemeral state)
  kv: {
    get<T>(key: string): Promise<T | null>
    set<T>(key: string, value: T, ttl?: number): Promise<void>
    delete(key: string): Promise<void>
    clear(pattern: string): Promise<number>
  }
}

export interface EventRecord {
  id: string
  ts: number
  type: string
  runId: string
  flowName: string
  stepName?: string
  stepId?: string
  attempt?: number
  data?: any
}

export interface EventReadOptions {
  fromId?: string
  limit?: number
  direction?: 'forward' | 'backward'
}

export interface EventSubscription {
  unsubscribe(): void
}

export interface ListOptions {
  limit?: number
  offset?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

// Application-level document schemas (not part of adapter interface)
export interface FlowWiring {
  steps: Record<string, StepDefinition>
  connections: Array<{ from: string; to: string; condition?: string }>
  _version: number
  updatedAt: number
}

export interface StepDefinition {
  name: string
  handler: string
  config?: Record<string, any>
  retry?: { attempts: number; backoff: number }
}

export interface TriggerDefinition {
  type: 'schedule' | 'event' | 'manual'
  config: Record<string, any>
  _version: number
}

export interface FlowMetadata {
  runId: string
  status: 'running' | 'completed' | 'failed'
  startedAt: number
  completedAt?: number
  stepCount: number
  completedSteps: number
  _version: number
}
```

**Key Simplifications:**

1. **Document Store replaces 12 methods:**
   - Old: `indexAdd`, `indexGet`, `indexUpdate`, `indexIncrement`, `indexRead`, `saveFlowWiring`, `getFlowWiring`, `listFlows`, `saveTrigger`, `getTrigger`, `listTriggers`, `indexUpdateWithRetry`
   - New: `save`, `get`, `list`, `delete` (4 methods for all structured data)

2. **Key-Value Store replaces 4 methods:**
   - Old: `getState`, `setState`, `deleteState`, `clearNamespace`
   - New: `kv.get`, `kv.set`, `kv.delete`, `kv.clear` (nested under `kv` for clarity)

3. **Cleanup methods removed:**
   - Old: `setMetadataTTL`, `cleanupCompletedFlows`, `deleteStream`, `deleteByPattern`, `deleteIndex`
   - New: Applications handle cleanup using `store.delete()`, `store.kv.clear()`, and TTL in `kv.set()`

4. **Total interface reduction:**
   - Before: 20+ methods
   - After: 11 methods (8 top-level + 3 in kv namespace)
   - **45% reduction in API surface**

---

## Appendix B: Example Adapter Implementation

### Memory Queue Adapter

```typescript
// packages/nvent/src/runtime/server/adapters/builtin/memory-queue.ts
import { QueueAdapter, Job, JobInput, ScheduleOptions, JobsQuery, QueueEvent, JobCounts } from '../interfaces/queue'

export class MemoryQueueAdapter implements QueueAdapter {
  private jobs = new Map<string, Map<string, Job>>()
  private listeners = new Map<string, Map<QueueEvent, Set<Function>>>()
  private jobCounter = 0
  
  async init(): Promise<void> {
    // No-op for memory adapter
  }
  
  async close(): Promise<void> {
    this.jobs.clear()
    this.listeners.clear()
  }
  
  async enqueue(queue: string, job: JobInput): Promise<string> {
    const id = `job-${++this.jobCounter}`
    const jobData: Job = {
      id,
      name: job.name,
      data: job.data,
      state: 'waiting',
      timestamp: Date.now()
    }
    
    if (!this.jobs.has(queue)) {
      this.jobs.set(queue, new Map())
    }
    
    this.jobs.get(queue)!.set(id, jobData)
    this.emit(queue, 'added', jobData)
    
    return id
  }
  
  async schedule(queue: string, job: JobInput, opts?: ScheduleOptions): Promise<string> {
    // Simplified: just enqueue with delay handling
    const id = await this.enqueue(queue, job)
    
    if (opts?.delay) {
      const jobData = await this.getJob(queue, id)
      if (jobData) {
        jobData.state = 'delayed'
        setTimeout(() => {
          jobData.state = 'waiting'
          this.emit(queue, 'waiting', jobData)
        }, opts.delay)
      }
    }
    
    return id
  }
  
  async getJob(queue: string, id: string): Promise<Job | null> {
    return this.jobs.get(queue)?.get(id) || null
  }
  
  async getJobs(queue: string, query?: JobsQuery): Promise<Job[]> {
    const queueJobs = this.jobs.get(queue)
    if (!queueJobs) return []
    
    let jobs = Array.from(queueJobs.values())
    
    if (query?.state) {
      jobs = jobs.filter(j => query.state!.includes(j.state!))
    }
    
    if (query?.limit) {
      jobs = jobs.slice(0, query.limit)
    }
    
    return jobs
  }
  
  async getJobCounts(queue: string): Promise<JobCounts> {
    const jobs = await this.getJobs(queue)
    return {
      active: jobs.filter(j => j.state === 'active').length,
      completed: jobs.filter(j => j.state === 'completed').length,
      failed: jobs.filter(j => j.state === 'failed').length,
      delayed: jobs.filter(j => j.state === 'delayed').length,
      waiting: jobs.filter(j => j.state === 'waiting').length,
      paused: jobs.filter(j => j.state === 'paused').length
    }
  }
  
  async pause(queue: string): Promise<void> {
    const jobs = await this.getJobs(queue, { state: ['waiting', 'active'] })
    jobs.forEach(job => {
      job.state = 'paused'
    })
    this.emit(queue, 'paused', { queue })
  }
  
  async resume(queue: string): Promise<void> {
    const jobs = await this.getJobs(queue, { state: ['paused'] })
    jobs.forEach(job => {
      job.state = 'waiting'
    })
    this.emit(queue, 'resumed', { queue })
  }
  
  async isPaused(queue: string): Promise<boolean> {
    const jobs = await this.getJobs(queue)
    return jobs.some(j => j.state === 'paused')
  }
  
  on(queue: string, event: QueueEvent, callback: (payload: any) => void): () => void {
    if (!this.listeners.has(queue)) {
      this.listeners.set(queue, new Map())
    }
    
    const queueListeners = this.listeners.get(queue)!
    if (!queueListeners.has(event)) {
      queueListeners.set(event, new Set())
    }
    
    queueListeners.get(event)!.add(callback)
    
    return () => {
      queueListeners.get(event)?.delete(callback)
    }
  }
  
  private emit(queue: string, event: QueueEvent, payload: any): void {
    const listeners = this.listeners.get(queue)?.get(event)
    if (listeners) {
      listeners.forEach(cb => cb(payload))
    }
  }
}
```

---

**End of Specification**
