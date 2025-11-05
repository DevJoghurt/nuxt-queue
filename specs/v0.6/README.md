# v0.6 Architecture Specifications

> **Status**: 📋 Planning Complete  
> **Last Updated**: 2025-11-05

## Overview

v0.6 introduces a complete architectural overhaul with clean separation of concerns, multiple queue adapters, and multi-language worker support.

## Core Architecture Principles

### 1. Separation of Concerns

Each system has a single, well-defined responsibility:

```
┌─────────────────────────────────────────────────────────────────┐
│                          nuxt-queue                             │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │ QueueProvider│  │WorkerManager │  │   Runner     │         │
│  │ Job queue    │  │ Registration │  │  Context &   │         │
│  │ operations   │  │ & execution  │  │  events      │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │ EventManager │  │StateProvider │  │  Registry    │         │
│  │ EventStore & │  │ State mgmt   │  │  Worker      │         │
│  │ streaming    │  │ via events   │  │  scanning    │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Unified Interfaces

All implementations (BullMQ, Memory, File, PgBoss) implement the same interfaces:
- **QueueProvider**: Job queue operations
- **WorkerManager**: Worker registration and execution

Application code works identically with any adapter - just change config.

### 3. Event-Driven Architecture

Everything is an event (v0.8-v0.9 specs):
- **flow.started** → Flow begins
- **step.started** → Worker starts
- **step.completed** → Worker succeeds
- **step.failed** → Worker fails
- **state.set** → State changes
- **runner.log** → Log entries

State is derived from events (event sourcing).

## Specifications

### [worker-execution.md](./worker-execution.md)
**Complete worker execution architecture**

Defines the separation between QueueProvider and WorkerManager:
- **QueueProvider Interface**: Job operations only (enqueue, getJob, pause, resume)
- **WorkerManager Interface**: Worker registration and execution
- **Runner Layer**: Context building and event emission
- **Dispatcher Pattern**: One worker per queue, routes by job.name
- **Multi-Runtime Support**: Python and isolated Node.js via ChildProcessRunner

**Key Insight**: QueueProvider is "dumb" - it only manages job queues. WorkerManager handles execution. Same runner (createNodeProcessor) works for all adapters.

### [dev-queue-adapters.md](./dev-queue-adapters.md)
**Memory & file queue adapters for development**

Introduces lightweight adapters for easier development:
- **Memory Adapter**: Ephemeral in-memory queue (fastq + Map)
- **File Adapter**: Persistent file-based queue (fastq + JSON files)
- **QueueProvider**: Handles job storage and queries
- **WorkerManager**: Executes workers using fastq
- **Zero Config**: Works out of the box, no Redis/PostgreSQL needed

**Key Insight**: Memory/File adapters are ADDITIONAL options alongside BullMQ/PgBoss (not replacements). They implement the exact same interfaces, so application code is identical.

### [multi-language-workers.md](./multi-language-workers.md)
**Python & isolated Node.js workers via child processes**

Multi-runtime support integrated into WorkerManager:
- **ChildProcessRunner**: Wraps handlers to run in child process
- **RPC Communication**: Context methods forwarded via JSON-RPC
- **Transparent Execution**: Application code doesn't know about child processes
- **Full Context**: State, logger, flow engine work identically
- **Python SDK**: nuxt_queue package with RunContext implementation

**Key Insight**: Multi-language support is not a separate system - it's a WorkerManager extension that transparently wraps handlers with ChildProcessRunner. Same registration flow for all runtimes.

### [combined-state-management.md](./combined-state-management.md)
**Event-sourced state with Zod validation**

State management via event sourcing:
- **State as Events**: All state changes are state.set events
- **Zod Validation**: State schema defined in defineQueueConfig
- **State Reducer**: Derives current state from event stream
- **Scoped State**: Per-flow state isolation

**Export Pattern**:
```typescript
export const config = defineQueueConfig({ ... }) // Named export
export default defineQueueWorker(async (job, ctx) => { ... }) // Default export
```

### [postgres-backend.md](./postgres-backend.md)
**PostgreSQL for queue & event storage**

Alternative to Redis:
- **PgBoss**: Queue provider (existing, unchanged)
- **PostgreSQL EventStore**: Events in tables instead of Redis Streams
- **LISTEN/NOTIFY**: Real-time updates via PostgreSQL
- **Single Database**: Everything in PostgreSQL


## Implementation Flow

### 1. Application Layer
```typescript
// server/queues/hello.ts
export default defineQueueWorker(async (job, ctx) => {
  // Your worker code
})

export const config = defineQueueConfig({
  runtime: 'node', // or 'python' or 'node-isolated'
  concurrency: 5
})
```

### 2. Registry Layer
Scans `server/queues/` and builds worker metadata:
```typescript
{
  id: 'hello',
  queue: { name: 'default' },
  worker: { runtime: 'node', concurrency: 5 },
  absPath: '/full/path/to/hello.ts'
}
```

### 3. WorkerManager Registration
```typescript
// Nitro plugin
const workerManager = getWorkerManager() // Auto-selects BullMQ/Memory/File

for (const worker of registry.workers) {
  await workerManager.registerWorker(
    worker.queue.name,
    worker.id,
    handler,
    worker.worker // includes runtime, concurrency, etc.
  )
}
```

### 4. Job Execution
```
Job enqueued → QueueProvider stores job
            → WorkerManager dispatches to handler
            → Runner builds context (state, logger, flow)
            → Handler executes
            → Runner emits events (step.started, step.completed)
            → QueueProvider updates job state
```

### 5. Multi-Runtime Execution
```
If runtime === 'python' or 'node-isolated':
  → WorkerManager wraps handler with ChildProcessRunner
  → ChildProcessRunner spawns child process
  → RPC communication for context methods
  → Handler executes in isolation
  → Result returned via RPC
  → Process cleanup
```

## Adapter Comparison

| Feature | Memory | File | BullMQ | PgBoss |
|---------|--------|------|--------|--------|
| **Persistence** | ❌ Ephemeral | ✅ Files | ✅ Redis | ✅ PostgreSQL |
| **Distributed** | ❌ Single | ❌ Single | ✅ Multi | ✅ Multi |
| **Speed** | 🚀 Fastest | ⚡ Fast | ✅ Production | ✅ Production |
| **Setup** | ✅ Zero config | ✅ Zero config | Redis required | PostgreSQL required |
| **Use Case** | Dev/Test | Dev/Test | Production | Production |
| **Multi-Runtime** | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |

## Configuration Examples

### Development (Memory)
```typescript
export default defineNuxtConfig({
  modules: ['nuxt-queue']
  // Auto-uses memory adapter in dev
})
```

### Development with Persistence (File)
```typescript
export default defineNuxtConfig({
  modules: ['nuxt-queue'],
  queue: {
    adapter: 'file',
    file: {
      path: '.nuxt-queue'
    }
  }
})
```

### Production (Redis)
```typescript
export default defineNuxtConfig({
  modules: ['nuxt-queue'],
  queue: {
    adapter: 'redis',
    redis: {
      url: process.env.REDIS_URL
    }
  }
})
```

### Production (PostgreSQL)
```typescript
export default defineNuxtConfig({
  modules: ['nuxt-queue'],
  queue: {
    adapter: 'postgres',
    postgres: {
      connectionString: process.env.DATABASE_URL
    }
  }
})
```

## Key Architectural Decisions

### ✅ QueueProvider Only Handles Queues
No eventStore, state, or logging in QueueProvider - those are separate systems. QueueProvider is "dumb" storage.

### ✅ WorkerManager Only Handles Workers
No queue operations in WorkerManager - it delegates to QueueProvider. WorkerManager registers handlers and manages execution.

### ✅ Same Runner for All Adapters
`createNodeProcessor` works identically for BullMQ, Memory, File, PgBoss. Only queue/worker management differs.

### ✅ Multi-Runtime as WorkerManager Extension
Child process execution is transparent - WorkerManager wraps handlers automatically based on `runtime` config.

### ✅ Event-Driven Everything
State, logs, flow control all via events. Single source of truth (event stream).

### ✅ Drop-In Adapter Replacement
Switch from Memory → File → Redis → PostgreSQL with just config change. Application code unchanged.

## Benefits

### For New Users
- **Zero Setup**: No Redis installation needed (memory adapter)
- **Fast Start**: npm install and start coding
- **Immediate Feedback**: Jobs process instantly
- **Simple Debugging**: All data in memory/files

### For Testing
- **Fast Tests**: In-memory adapter is 100x faster than Redis
- **Isolated**: Each test gets fresh adapter instance
- **Deterministic**: File adapter for snapshot testing
- **No Mocking**: Real queue behavior in tests

### For Development
- **Rapid Iteration**: No connection delays
- **Portable**: Works on any machine
- **Git-Friendly**: File adapter state can be committed
- **Production-Like**: Same API as Redis adapter

### For Architecture
- **Clean Separation**: Each system has single responsibility
- **Unified Interfaces**: All adapters implement same API
- **Easy Migration**: Switch adapters with config change
- **Multi-Language**: Python, Node.js, more to come
- **Testable**: Mock any layer independently

## Next Steps

1. **Implementation**: Implement specs in order:
   - `worker-execution.md` - Core architecture
   - `dev-queue-adapters.md` - Memory/File adapters
   - `multi-language-workers.md` - Python/isolated Node.js
   
2. **Testing**: Comprehensive test suite for all adapters

3. **Documentation**: User guides for each adapter and runtime

4. **Examples**: Demo projects showing each feature

## Related Specs

- **v0.5**: [Trigger System](../v0.5/trigger-system.md)
- **v0.7**: [Client Streaming](../v0.7/client-streaming.md)
- **v0.8**: [Event-Based Registry](../v0.8/) (TBD)
- **v0.9**: [Logging as Events](../v0.9/) (TBD)
