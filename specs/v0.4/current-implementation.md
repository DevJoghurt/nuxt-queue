# Nuxt Queue v0.4 - Current Implementation

Complete architecture documentation for the current implementation of nuxt-queue.

## Overview

Nuxt Queue is a BullMQ-based queue and flow orchestration system for Nuxt with integrated event sourcing and real-time monitoring. It combines reliable job processing with stream-based event tracking and provides a development UI for monitoring.

### Key Features

- **Queue Management**: BullMQ integration for reliable job processing
- **Flow Orchestration**: Multi-step workflows with event sourcing
- **Event Sourcing**: Stream-based event storage with Redis Streams
- **Real-time Updates**: Redis Pub/Sub for <100ms latency
- **Worker Context**: Rich runtime with state, logging, and event emission
- **Auto-discovery**: Registry system that scans filesystem for workers
- **Development UI**: Real-time monitoring with Vue Flow diagrams
- **Horizontal Scaling**: Stateless architecture

## Architecture

### High-Level Components

```
┌──────────────────────────────────────────────────────────────┐
│                        Nuxt Module                           │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│  │  Registry  │  │  Templates │  │   Config   │            │
│  └────────────┘  └────────────┘  └────────────┘            │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                      Runtime Layer                           │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│  │   Queue    │  │   Stream   │  │   State    │            │
│  │  Provider  │  │   Store    │  │  Provider  │            │
│  └────────────┘  └────────────┘  └────────────┘            │
│                                                              │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│  │   Event    │  │  Worker    │  │   Flow     │            │
│  │  Manager   │  │  Runner    │  │  Engine    │            │
│  └────────────┘  └────────────┘  └────────────┘            │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                     Infrastructure                           │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│  │   Redis    │  │   BullMQ   │  │   Nitro    │            │
│  └────────────┘  └────────────┘  └────────────┘            │
└──────────────────────────────────────────────────────────────┘
```

### Data Flow

```
1. Flow Start
   User/API → Flow Engine → Queue Provider (BullMQ) → Worker Runner

2. Step Execution
   Worker Runner → Execute Handler → Emit Events → Event Manager

3. Event Storage
   Event Manager → Stream Store → Redis Streams (XADD)
                                → Redis Pub/Sub (PUBLISH)

4. Real-time Distribution
   Redis Pub/Sub → SSE Endpoint → Browser Client

5. State Management
   Worker Context → State Provider → Redis (Nitro Storage)
```

## Module System

### Registry

The registry auto-discovers workers and flows from the filesystem at build time.

**Location**: `src/registry/`

**Key Files**:
- `scan.ts` - Scans filesystem for workers
- `flows.ts` - Builds flow graph from worker configs
- `loaders/` - Language-specific loaders (ts, js, py)

**Process**:
1. Scans all layers' `server/queues/` directories
2. Loads worker files and extracts config
3. Builds flow graph from `flow.emits` and `flow.subscribes` patterns
4. Compiles to static registry JSON with event index
5. Generates TypeScript templates for imports

**Registry Structure**:
```typescript
{
  version: 1,
  compiledAt: "2025-10-30T...",
  provider: { name: 'bullmq' },
  logger: { name: 'console', level: 'info' },
  state: { name: 'redis', namespace: 'nq', autoScope: 'always' },
  eventStore: { name: 'redis' },
  runner: { 
    ts: { isolate: 'inprocess' },
    py: { enabled: false, cmd: 'python3', importMode: 'file' }
  },
  workers: [
    {
      id: 'first_step',
      name: 'first_step',
      queue: 'example',
      kind: 'ts',
      runtype: 'inprocess',
      absPath: '/path/to/first_step.ts',
      flow: { 
        names: ['example-flow'],
        role: 'entry',
        step: 'first_step',
        emits: ['data.processed']
      }
    }
  ],
  flows: {
    'example-flow': {
      entry: { step: 'first_step', queue: 'example', workerId: 'first_step' },
      steps: { 
        'second_step': { 
          queue: 'example', 
          workerId: 'second_step',
          subscribes: ['data.processed']
        }
      }
    }
  },
  eventIndex: {
    'data.processed': [
      { flowId: 'example-flow', step: 'second_step', queue: 'example', workerId: 'second_step' }
    ]
  }
}
```

### Templates

Generated at build time to provide type-safe imports.

**queue-registry.ts**:
```typescript
export const registry = { /* compiled registry */ }
export type QueueRegistry = typeof registry
export const useQueueRegistry = (): QueueRegistry => registry
```

**worker-handlers.ts**:
```typescript
import h0 from '/path/to/first_step.ts'
import h1 from '/path/to/second_step.ts'

export const handlers = [
  { queue: 'example', id: 'first_step', absPath: '...', handler: h0 },
  { queue: 'example', id: 'second_step', absPath: '...', handler: h1 }
]
```

### Hot Reload (Dev)

In development, the module watches for file changes and regenerates the registry:

```typescript
// Vite watcher
server.watcher.on('all', (event, file) => {
  if (file.includes('/server/queues/')) {
    refreshRegistry()
  }
})
```

## Runtime Layer

### Queue Provider

**Location**: `src/runtime/server/queue/`

**Interface**: `QueueProvider`
- `enqueue(queue, job)` - Add job to queue
- `schedule(queue, job, opts)` - Schedule job
- `getJob(queue, id)` - Get job by ID
- `getJobs(queue, query)` - List jobs
- `on(queue, event, callback)` - Subscribe to queue events
- `pause(queue)` / `resume(queue)` - Control queue

**Current Adapter**: BullMQ (`adapters/bullmq.ts`)

### Stream Store

**Location**: `src/runtime/server/streamStore/`

**Purpose**: Event sourcing with Redis Streams

**Interface**: `StreamAdapter`
```typescript
interface StreamAdapter {
  append(subject: string, event: Omit<EventRecord, 'id' | 'ts'>): Promise<EventRecord>
  read(subject: string, opts?: EventReadOptions): Promise<EventRecord[]>
  subscribe(subject: string, onEvent: (e: EventRecord) => void): Promise<EventSubscription>
  close(): Promise<void>
}
```

**Implementation**: Redis Streams (`adapters/redisStreamsAdapter.ts`)

**Storage Pattern**:
- One stream per flow run: `nq:flow:<runId>`
- Events appended with XADD
- Published to Pub/Sub channel: `nq:events:nq:flow:<runId>`
- Subscribers receive via Redis Pub/Sub

**Event Structure**:
```typescript
{
  id: "1719667845123-0",        // Redis stream ID (auto)
  ts: "2025-10-30T...",          // ISO timestamp (auto)
  type: "step.completed",        // Event type
  runId: "abc-123-def",          // Flow run UUID
  flowName: "example",           // Flow definition name
  stepName?: "first_step",       // Optional for step events
  stepId?: "step-1",             // Optional for step events
  attempt?: 1,                   // Optional for step events
  data?: { result: {...} }       // Optional payload
}
```

**Real-time Distribution**:
1. Worker emits event
2. Event Manager calls `streamStore.append()`
3. Append does XADD + PUBLISH
4. Subscribers (SSE endpoints) receive via Pub/Sub
5. <100ms latency from emit to browser

### State Provider

**Location**: `src/runtime/server/state/`

**Purpose**: Per-flow state management

**Interface**: `StateProvider`
```typescript
interface StateProvider {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T, opts?: { ttl?: number }): Promise<void>
  delete(key: string): Promise<void>
}
```

**Current Adapter**: Redis (`adapters/redis.ts`)

**Storage Pattern**:
- Uses Nitro's `useStorage()` with redis driver
- Keys scoped by flow: `nq:flow:<runId>:<key>`
- Optional TTL support
- Cleanup strategies: never, immediate, ttl, on-complete

**Worker Access**:
```typescript
await ctx.state.set('myKey', { value: 123 })
const data = await ctx.state.get('myKey')
```

### Event Manager

**Location**: `src/runtime/server/utils/useEventManager.ts`

**Purpose**: Central event publishing hub

**Methods**:
```typescript
const manager = useEventManager()

// Publish to stream store + internal bus
await manager.publishBus(event)

// Get stream store adapter
const store = manager.getStreamStore()
```

**Flow**:
1. Worker calls `ctx.emit(event)`
2. Routed to `useEventManager().publishBus()`
3. Event normalized to v0.4 schema
4. Published to stream store (Redis Streams + Pub/Sub)
5. Emitted to internal event bus for in-process listeners

### Flow Engine

**Location**: `src/runtime/server/utils/useFlowEngine.ts`

**Purpose**: Flow orchestration

**Methods**:
```typescript
const engine = useFlowEngine()

// Start a flow
await engine.startFlow(flowName, input, opts)

// Handle trigger (future)
await engine.handleTrigger(trigger, payload)
```

**Implementation**:
- Looks up flow in registry
- Enqueues entry point step to BullMQ
- Emits `flow.start` event
- Workers emit custom events when done
- Event plugin checks event index and enqueues subscribed steps
- Emits `flow.completed` when all steps done

### Worker Runner

**Location**: `src/runtime/server/worker/runner/node.ts`

**Purpose**: Executes worker handlers with rich context

**Context Structure**:
```typescript
interface RunContext {
  jobId?: string
  queue?: string
  flowId?: string           // Flow run UUID
  flowName?: string         // Flow definition name
  stepName?: string         // Current step name
  stepId?: string           // Current step ID
  attempt?: number          // Attempt number
  logger: RunLogger         // Logging interface
  state: RunState           // State management
  emit: (event) => void     // Event emission
  flow: FlowEngine          // Flow control
}
```

**Execution Flow**:
1. BullMQ worker receives job
2. `executeWorker()` builds context
3. Loads handler from registry
4. Calls `handler(job, ctx)`
5. Emits `step.started`, logs, `step.completed`
6. Handler emits custom events via `ctx.emit()`
7. Flow plugin listens to emitted events and enqueues subscribed steps
8. Handles errors and emits `step.failed`

**Logger**:
```typescript
ctx.logger.log('info', 'Message', { meta })
// Emits 'log' event to stream
```

**State**:
```typescript
await ctx.state.set('key', value, { ttl: 3600000 })
const val = await ctx.state.get('key')
// Scoped to flow: nq:flow:<runId>:key
```

**Event Emission**:
```typescript
ctx.emit({ type: 'custom.event', data: {...} })
// Published to stream and internal bus
```

## API Endpoints

### Flow APIs

**Location**: `src/runtime/server/api/_flows/`

#### Start Flow
```
POST /api/_flows/:flowName/start
Body: { input?: any }
Response: { flowId: string, startedAt: string }
```

#### List Runs
```
GET /api/_flows/:flowName/runs?limit=50
Response: [{ id, flowName, status, startedAt, ... }]
```

#### Get Run
```
GET /api/_flows/:flowName/runs/:runId
Response: { events: EventRecord[], status: string, steps: {...} }
```

#### Stream Events (SSE)
```
GET /api/_flows/:flowName/runs/:runId/stream
Response: Server-Sent Events stream

Event format:
data: {"id":"...","ts":"...","type":"step.completed",...}
```

**Implementation**:
1. Backfill: Read existing events from stream
2. Subscribe: Use Pub/Sub for real-time events
3. Send as SSE: `data: ${JSON.stringify(event)}\n\n`

### Queue APIs

**Location**: `src/runtime/server/api/_queues/`

#### Get Queue Info
```
GET /api/_queues/:queueName
Response: { name, counts: { active, waiting, ... } }
```

#### List Jobs
```
GET /api/_queues/:queueName/jobs?state=completed&limit=50
Response: [{ id, name, data, state, ... }]
```

#### Enqueue Job
```
POST /api/_queues/:queueName/enqueue
Body: { name: string, data: any, opts?: any }
Response: { jobId: string }
```

## UI Components

**Location**: `src/runtime/app/`

### Pages

- `pages/index.vue` - Main dashboard
- `pages/dashboard/` - Overview statistics
- `pages/flows/` - Flow listing and detail
- `pages/queue/` - Queue monitoring
- `pages/events/` - Event stream viewer

### Components

- `FlowDiagram.vue` - Vue Flow visualization
- `FlowRunTimeline.vue` - Event timeline
- `FlowRunLogs.vue` - Filtered log view
- `FlowRunOverview.vue` - Summary statistics
- `StatCounter.vue` - Metric display

### Composables

- `useFlowState.ts` - Client-side event reduction
- `useEventSSE.ts` - SSE connection management
- `createEventStream.ts` - Event stream helper
- `useComponentRouter.ts` - Navigation helper

## Worker Development

### Basic Worker

```typescript
// server/queues/example/my_step.ts
export default defineQueueWorker(async (job, ctx) => {
  // Access job data
  const input = job.data
  
  // Log
  ctx.logger.log('info', 'Processing', { input })
  
  // State
  await ctx.state.set('status', 'processing')
  
  // Do work
  const result = await processData(input)
  
  // Emit custom event to trigger other steps
  ctx.emit({ type: 'emit', data: { name: 'processing.complete', result } })
  
  // Return result
  return result
})

export const config = defineQueueConfig({
  concurrency: 5,
  flow: {
    names: ['my-flow'],
    role: 'step',
    step: 'my_step',
    emits: ['processing.complete']
  }
})
```

### Flow Entry Point

```typescript
// server/queues/my-flow/start.ts
export default defineQueueWorker(async (job, ctx) => {
  const input = job.data
  ctx.logger.log('info', 'Flow started', { input })
  
  // Process data
  const prepared = { prepared: input }
  
  // Emit event to trigger next steps
  ctx.emit({ type: 'emit', data: { name: 'flow.prepared', ...prepared } })
  
  return prepared
})

export const config = defineQueueConfig({
  flow: {
    names: ['my-flow'],
    role: 'entry',
    step: 'start',
    emits: ['flow.prepared']
  }
})
```

### Flow Step

```typescript
// server/queues/my-flow/process_step.ts
export default defineQueueWorker(async (job, ctx) => {
  const fromPrevious = job.data
  
  // Do processing
  const processed = await transform(fromPrevious)
  
  // State persisted across steps
  await ctx.state.set('processed', processed)
  
  // Emit event to trigger final step
  ctx.emit({ type: 'emit', data: { name: 'processing.done', ...processed } })
  
  return processed
})

export const config = defineQueueConfig({
  flow: {
    names: ['my-flow'],
    role: 'step',
    step: 'process_step',
    subscribes: ['flow.prepared'],  // Triggered by start step
    emits: ['processing.done']
  }
})
```

### Parallel Steps

```typescript
// Entry point emits event that multiple steps subscribe to
export const config = defineQueueConfig({
  flow: {
    names: ['my-flow'],
    role: 'entry',
    step: 'start',
    emits: ['work.ready']  // All steps subscribing to this will execute in parallel
  }
})

// step_a.ts
export const config = defineQueueConfig({
  flow: {
    names: ['my-flow'],
    role: 'step',
    step: 'step_a',
    subscribes: ['work.ready']
  }
})

// step_b.ts
export const config = defineQueueConfig({
  flow: {
    names: ['my-flow'],
    role: 'step',
    step: 'step_b',
    subscribes: ['work.ready']
  }
})

// step_c.ts
export const config = defineQueueConfig({
  flow: {
    names: ['my-flow'],
    role: 'step',
    step: 'step_c',
    subscribes: ['work.ready']
  }
})
```

## Configuration

### Module Options

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['nuxt-queue'],
  queue: {
    dir: 'queues',        // Worker directory
    ui: true,             // Enable UI
    redis: {
      host: '127.0.0.1',
      port: 6379,
    }
  }
})
```

### Runtime Config

```typescript
runtimeConfig: {
  queue: {
    redis: { ... },
    state: {
      name: 'redis',
      namespace: 'nq',
      autoScope: 'always',
      cleanup: {
        strategy: 'never',  // or 'immediate', 'ttl', 'on-complete'
        ttlMs: 86400000
      }
    },
    eventStore: {
      name: 'redis',
      mode: 'streams',
      options: {
        redisStreams: {
          trim: { maxLen: 10000, approx: true }
        }
      }
    }
  }
}
```

### Worker Config

```typescript
export const config = defineQueueConfig({
  concurrency: 5,           // Max concurrent jobs
  limiter: {
    max: 100,
    duration: 60000
  },
  flow: {
    names: ['flow-name'],           // Flow(s) this step belongs to
    role: 'entry' | 'step',         // Entry point or regular step
    step: 'step_name',              // This step's name
    emits: ['event.name'],          // Events this step emits
    subscribes: ['other.event']     // Events this step subscribes to
  }
})
```

## Deployment

### Scaling Workers

Workers can be scaled horizontally:

```bash
# Instance 1 - Handle flows
NODE_OPTIONS="--max-old-space-size=2048" node .output/server/index.mjs

# Instance 2 - Handle flows
NODE_OPTIONS="--max-old-space-size=2048" node .output/server/index.mjs

# Instance 3 - API only, no workers
BULLMQ_WORKER_ENABLED=0 node .output/server/index.mjs
```

All instances share Redis, enabling:
- Load balancing across workers
- Real-time events via Pub/Sub
- Shared state via Redis

### Environment Variables

```bash
# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=secret

# Queue
NQ_NAMESPACE=nq
NQ_DEBUG_EVENTS=1

# Workers
BULLMQ_WORKER_ENABLED=1
```

## Performance Characteristics

### Latencies

- **Event write**: 2-5ms (XADD + PUBLISH)
- **Event read**: 5-10ms (XRANGE)
- **Real-time delivery**: <100ms (Pub/Sub)
- **State get/set**: 1-3ms (Redis)
- **Job enqueue**: 2-5ms (BullMQ)

### Storage

- **Per flow run**: 5-15KB (depends on events)
- **Per event**: ~200-500 bytes
- **Flow index**: ~100 bytes per run

### Scaling

- **Workers**: Horizontal (multiple instances)
- **Queue throughput**: 1000+ jobs/sec (BullMQ)
- **Event throughput**: 5000+ events/sec (Redis Streams)
- **Real-time connections**: 1000+ per instance (SSE)

## Current Limitations

1. **TypeScript only**: Python workers not yet implemented
2. **No triggers/await**: Planned for next version
3. **Redis only**: No Postgres adapter yet
4. **State separate from events**: Not unified with stream store
5. **Basic logging**: No advanced logger adapters
6. **Flow-coupled workers**: Workers can't be called directly as HTTP handlers

## Migration Notes

### From v0.3

v0.4 is the current implementation. v0.3 was a design specification that informed v0.4.

Key changes from v0.3 spec:
- Event schema uses `runId` instead of `subject`
- Removed trigger-related fields (not yet implemented)
- Added `stepId` field for step tracking
- State provider is separate (not unified with stream store)

## Troubleshooting

### Events Not Appearing

```bash
# Check stream exists
redis-cli XLEN nq:flow:<runId>

# Check Pub/Sub
redis-cli PUBSUB CHANNELS nq:events:*

# Enable debug
NQ_DEBUG_EVENTS=1
```

### Worker Not Executing

```bash
# Check registry
curl http://localhost:3000/api/_flows

# Check BullMQ queue
redis-cli LLEN bull:<queue>:wait

# Check worker logs
```

### State Not Persisting

```bash
# Check Redis storage
redis-cli KEYS nq:flow:*

# Check config
console.log(useRuntimeConfig().queue.state)
```

## Best Practices

1. **Keep steps small**: Each step should do one thing
2. **Use state for shared data**: Don't pass large objects between steps
3. **Log appropriately**: Use info for milestones, debug for details
4. **Handle errors**: Wrap critical code in try/catch
5. **Set concurrency**: Limit based on resource requirements
6. **Monitor metrics**: Use the UI to track performance
7. **Clean up state**: Use TTL or on-complete cleanup

## References

- [BullMQ Documentation](https://docs.bullmq.io/)
- [Redis Streams](https://redis.io/docs/data-types/streams/)
- [Redis Pub/Sub](https://redis.io/docs/manual/pubsub/)
- [Nuxt Documentation](https://nuxt.com/)
- [Vue Flow](https://vueflow.dev/)

---

**Version**: v0.4.0  
**Last Updated**: 2025-10-30  
**Status**: ✅ Current Implementation
