# Nvent

Event-sourced queue and flow orchestration for Nuxt. Zero dependencies to get started - built-in memory/file adapters included. Scale to Redis when ready.

## ✨ Features

- 🚀 **Zero Setup**: Start instantly with built-in memory/file adapters - no Redis required
- 🔄 **Queue Management**: Reliable job processing with pluggable queue adapters
- 🎭 **Flow Orchestration**: Multi-step workflows with event sourcing
- ⏰ **Flow Scheduling**: Cron-based and delayed flow execution
- 🔌 **Pluggable Adapters**: Built-in memory/file support, optional Redis adapters for production
- 📊 **Event Sourcing**: Complete audit trail of all flow operations
- 🎨 **Development UI**: Visual flow diagrams, timeline, and scheduling (separate package)
- 🔌 **Function Context**: Rich runtime with state, logging, and events
- 📦 **Auto-discovery**: Filesystem-based worker registry
- 🚀 **Horizontal Scaling**: Stateless architecture with Redis adapters
- 🔍 **Full Observability**: Real-time logs, metrics, and event streams
- 🛑 **Flow Control**: Cancel running flows, detect stalled flows, query flow status


---

**Version**: v0.4.5  
**Status**: ✅ Current Implementation  
**Last Updated**: 2025-11-18
✅ Core queue and flow functionality  
✅ Built-in memory/file adapters - no Redis required to start  
✅ Optional Redis adapters for production scaling  
✅ Event sourcing with stream adapters  
✅ Real-time monitoring UI (separate @nvent-addon/app package)  
✅ Flow scheduling (cron patterns and delays)  
✅ Flow control (cancel, query running flows, stall detection)  
✅ Worker context with state, logging, and events  
✅ Auto-discovery and flow analysis  
🚧 Comprehensive trigger system (planned v0.5)  
🚧 Python functions (planned v0.5)  
🚧 Postgres adapters (planned v0.6)


## 🗃️ Event Schema & Storage

All flow operations are event-sourced and stored in streams (`nq:flow:<runId>`). Events are immutable, type-safe, and provide a complete audit trail.

**Event types:**

  - `flow.start`, `flow.completed`, `flow.failed`, `flow.cancel`, `flow.stalled`
  - `step.started`, `step.completed`, `step.failed`, `step.retry`
  - `log`, `emit`, `state`

**Storage Options:**
- **Built-in**: Memory (development), File (persistence without database)
- **Production**: Redis Streams with `@nvent-addon/adapter-stream-redis`

See [Event Schema](./specs/v0.4/event-schema.md) for full details and field definitions.

## 🏆 Best Practices

- Keep steps small and focused
- Use state for shared data between steps
- Use `ctx.flow.emit()` to trigger downstream steps
- Log with context using `ctx.logger.log()`
- Set concurrency based on resource needs
- Use `on-complete` state cleanup for automatic state management
- Document schedules with metadata for maintainability

## ⚠️ Limitations (v0.4.5)

1. **TypeScript only**: Python functions not yet implemented (planned for v0.5)
2. **No complex triggers**: Only basic scheduling available (v0.5 will add triggers)
3. **No await patterns**: Pausing flows for time/events planned for v0.5
4. **No Postgres adapters**: Only memory/file/Redis adapters available (Postgres planned for v0.6)
5. **State separate from events**: Not unified with stream store (planned for v0.6)
6. **Basic logging**: No advanced logger adapters (planned for v0.7)
7. **No schedule editing**: Must delete and recreate schedules (v0.5 will add full trigger management)
8. **File adapter limitations**: Single instance only, not suitable for horizontal scaling


## 🚀 Quick Start

### Installation

**Core package (zero dependencies to start):**
```sh
npm install nvent
```

**Optional UI package:**
```sh
npm install @nvent-addon/app
```

**Optional Redis adapters for production:**
```sh
npm install @nvent-addon/adapter-queue-redis
npm install @nvent-addon/adapter-store-redis
npm install @nvent-addon/adapter-stream-redis
```

### Configuration

**Minimal setup (uses built-in memory adapters):**
```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['nvent'],
})
```

**With persistence (file adapters):**
```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['nvent'],
  nvent: {
    queue: {
      adapter: 'file',
      dataDir: './.data/queue'
    },
    store: {
      adapter: 'file',
      dataDir: './.data/store'
    },
    stream: {
      adapter: 'file',
      dataDir: './.data/stream'
    }
  }
})
```

**Production setup (Redis adapters):**
```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: [
    'nvent',
    '@nvent-addon/adapter-queue-redis',
    '@nvent-addon/adapter-store-redis',
    '@nvent-addon/adapter-stream-redis',
    '@nvent-addon/app'  // Optional UI
  ],
  nvent: {
    // Shared Redis connection
    connections: {
      redis: {
        host: '127.0.0.1',
        port: 6379
      }
    },
    // Configure adapters
    queue: {
      adapter: 'redis',
      defaultConfig: { concurrency: 2 }
    },
    store: {
      adapter: 'redis'
    },
    stream: {
      adapter: 'redis'
    },
    // Flow configuration
    flows: {
      stallDetection: {
        enabled: true,
        timeout: 300000  // 5 minutes
      }
    }
  }
})
```

### Create Your First Function

```typescript
// server/functions/example/process.ts
export default defineFunction(async (job, ctx) => {
  // Access job data
  const { message } = job.data
  
  // Log to stream
  ctx.logger.log('info', 'Processing message', { message })
  
  // Store state
  await ctx.state.set('processedAt', new Date().toISOString())
  
  // Return result
  return { success: true, processed: message }
})

export const config = defineFunctionConfig({
  concurrency: 5,
})
```

### Enqueue a Job

```typescript
// API route or wherever
const queue = useQueueAdapter()
await queue.enqueue('process', {
  name: 'process',
  data: { message: 'Hello World' }
})
```

### Create a Flow

Multi-step workflows with event-driven orchestration:

```typescript
// server/functions/my-flow/start.ts
export default defineFunction(async (job, ctx) => {
  ctx.logger.log('info', 'Flow started')
  const prepared = { step: 1, data: job.data }
  
  // Emit event to trigger next steps
  ctx.flow.emit('data.prepared', prepared)
  
  return prepared
})

export const config = defineFunctionConfig({
  flow: {
    name: ['my-flow'],
    role: 'entry',
    step: 'start',
    emits: ['data.prepared']
  }
})

// server/functions/my-flow/process.ts
export default defineFunction(async (job, ctx) => {
  const result = await processData(job.data)
  
  // Emit to trigger next step
  ctx.flow.emit('data.processed', result)
  
  return result
})

export const config = defineFunctionConfig({
  flow: {
    name: ['my-flow'],
    role: 'step',
    step: 'process',
    subscribes: ['data.prepared'],  // Triggered by start
    emits: ['data.processed']
  }
})

// server/functions/my-flow/validate.ts
export default defineFunction(async (job, ctx) => {
  const validated = await validate(job.data)
  ctx.flow.emit('validation.complete', validated)
  return validated
})

export const config = defineFunctionConfig({
  flow: {
    name: ['my-flow'],
    role: 'step',
    step: 'validate',
    subscribes: ['data.prepared'],  // Also triggered by start (parallel with process)
    emits: ['validation.complete']
  }
})
```

**Start the flow:**
```typescript
const { startFlow } = useFlowEngine()
await startFlow('my-flow', { input: 'data' })
```

**Check flow status:**
```typescript
const { isRunning, getRunningFlows, cancelFlow } = useFlowEngine()

// Check if specific run is still active
const running = await isRunning('my-flow', runId)

// Get all running instances of a flow
const runs = await getRunningFlows('my-flow')

// Cancel a running flow
await cancelFlow('my-flow', runId)
```

**Flow execution**: Entry step emits `data.prepared` → Both `process` and `validate` steps run in parallel (they both subscribe to `data.prepared`) → Each emits its own completion event for downstream steps.

### Schedule a Flow

Schedule flows to run automatically with cron patterns or delays:

```typescript
// Schedule a flow to run daily at 2 AM
await $fetch('/api/_flows/my-flow/schedule', {
  method: 'POST',
  body: {
    cron: '0 2 * * *',
    input: { retentionDays: 30 },
    metadata: {
      description: 'Daily cleanup job'
    }
  }
})

// Schedule a one-time delayed execution (5 minutes)
await $fetch('/api/_flows/reminder-flow/schedule', {
  method: 'POST',
  body: {
    delay: 300000,  // milliseconds
    input: { userId: '123', message: 'Check your email' }
  }
})

// List all schedules for a flow
const schedules = await $fetch('/api/_flows/my-flow/schedules')

// Delete a schedule
await $fetch('/api/_flows/my-flow/schedules/schedule-id', {
  method: 'DELETE'
})
```

**Common cron patterns:**
- `* * * * *` - Every minute
- `*/5 * * * *` - Every 5 minutes
- `0 * * * *` - Every hour
- `0 2 * * *` - Daily at 2 AM
- `0 9 * * 1` - Every Monday at 9 AM
- `0 0 1 * *` - First day of month at midnight

## 🎨 Development UI

**Install the UI package:**
```sh
npm install @nvent-addon/app
```

**Add to your Nuxt modules:**
```ts
export default defineNuxtConfig({
  modules: ['nvent', '@nvent-addon/app']
})
```

Access the built-in UI as `<NventApp />` component:

- 📊 **Dashboard**: Overview of queues and flows
- 🔄 **Flow Diagrams**: Visual representation with Vue Flow
- ⏰ **Flow Scheduling**: Create and manage cron-based or delayed schedules
- 📝 **Event Timeline**: Real-time event stream with step details
- 📋 **Logs**: Filtered logging by flow/step
- 📈 **Metrics**: Queue statistics and performance
- 🔍 **Flow Runs**: Complete history with status tracking (running, completed, failed, canceled, stalled)

## 🏗️ Architecture

### Pluggable Adapters

Nvent uses a three-tier adapter system:

1. **Queue Adapter**: Job processing and scheduling
   - Built-in: `memory`, `file`
   - Redis: `@nvent-addon/adapter-queue-redis` (BullMQ)

2. **Store Adapter**: Document and key-value storage
   - Built-in: `memory`, `file`
   - Redis: `@nvent-addon/adapter-store-redis`

3. **Stream Adapter**: Event sourcing and real-time distribution
   - Built-in: `memory`, `file`
   - Redis: `@nvent-addon/adapter-stream-redis` (Redis Streams + Pub/Sub)

### Event Sourcing

Every flow operation is stored as an event in streams:

```
nq:flow:<runId>
├─ flow.start
├─ step.started
├─ log
├─ step.completed
├─ step.started
├─ log
├─ step.completed
└─ flow.completed
```

Terminal states: `flow.completed`, `flow.failed`, `flow.cancel`, `flow.stalled`

### Real-time Distribution

With Redis stream adapter, events are broadcast via Pub/Sub for instant UI updates (<100ms latency).

### Function Context

Every function receives a rich context:

```typescript
{
  jobId: string              // BullMQ job ID
  queue: string              // Queue name
  flowId: string             // Flow run UUID
  flowName: string           // Flow definition name
  stepName: string           // Current step name
  logger: {
    log(level, msg, meta)    // Structured logging
  },
  state: {
    get(key)                 // Get flow-scoped state
    set(key, value, opts)    // Set with optional TTL
    delete(key)              // Delete state
  },
  flow: {
    emit(eventName, data)    // Emit flow event to trigger subscribed steps
    startFlow(name, input)   // Start nested flow
    cancelFlow(name, runId)  // Cancel a running flow
    isRunning(name, runId?)  // Check if flow is running
    getRunningFlows(name)    // Get all running instances
  }
}
```

## 📚 Documentation

### v0.4 Documentation
- **[Current Implementation](./specs/v0.4/current-implementation.md)** - Complete v0.4 architecture
- **[Event Schema](./specs/v0.4/event-schema.md)** - Event types and structure
- **[Flow Scheduling](./specs/v0.4/flow-scheduling.md)** - Scheduling specification
- **[Quick Reference](./specs/v0.4/quick-reference.md)** - One-page API reference

### API & Advanced
- **[API Reference](./specs/v0.4/current-implementation.md#api-endpoints)** - REST endpoints for flows/queues
- **[Logging](./specs/v0.4/logging.md)** - Server logging and best practices

### Roadmap & Future
- **[Roadmap](./specs/roadmap.md)** - Planned features across versions
- **[v0.5 Trigger System](./specs/v0.5/trigger-system.md)** - Next-gen event handling
- **[v0.6 Multi-language Functions](./specs/v0.6/multi-language-workers.md)** - Python support
- **[v0.6 Postgres Backend](./specs/v0.6/postgres-backend.md)** - PgBoss integration

## 🔮 Roadmap

### v0.4.5 (Current - November 2025)
✅ Core queue and flow orchestration  
✅ Built-in memory/file adapters - zero setup required  
✅ Optional Redis adapters for production scaling  
✅ Modular package structure (core + addons)  
✅ Event sourcing with pluggable stream adapters  
✅ Real-time monitoring UI (separate @nvent-addon/app package)  
✅ Flow scheduling (cron and delays)  
✅ Flow control (cancel, query status, stall detection)  
✅ Function context with state and logging  
✅ Improved configuration structure  

### v0.5
- 🎯 Comprehensive trigger system (schedule, webhook, event, manual)
- ⏱️ Await patterns (time, event, condition)
- 🐍 Python function support with RPC bridge
- 🔗 Webhook triggers with auto-setup

### v0.6
- 🐘 PgBoss queue provider option
- 🗄️ Postgres stream store adapter
- 🔄 Unified state and event storage
- 📊 Advanced state management

### v0.7
- 📊 Enhanced logger with multiple adapters
- 🌐 HTTP mode for functions (REST/gRPC)
- 🔌 External service hooks
- 🎨 Pluggable function execution modes

See [specs/roadmap.md](./specs/roadmap.md) for complete details.

## 🤝 Contributing

Contributions welcome! Please read our architecture docs first:

1. Review [specs/v0.4/current-implementation.md](./specs/v0.4/current-implementation.md)
2. Check [specs/roadmap.md](./specs/roadmap.md) for planned features
3. Open an issue to discuss changes
4. Submit a PR with tests

### Development Setup

```bash
# Install dependencies
yarn install

# Start playground with dev UI
cd playground
yarn dev

# Run tests
yarn test
```

## 📄 License

[MIT License](./LICENSE) - Copyright (c) DevJoghurt