# Nuxt Queue

Event-sourced queue and flow orchestration for Nuxt. Built on BullMQ with integrated real-time monitoring and multi-step workflow support.

## ✨ Features

- 🔄 **Queue Management**: Reliable job processing with BullMQ
- 🎭 **Flow Orchestration**: Multi-step workflows with event sourcing
- ⏰ **Flow Scheduling**: Cron-based and delayed flow execution
- ⚡ **Real-time Updates**: Redis Pub/Sub for <100ms latency monitoring
- 📊 **Event Sourcing**: Complete audit trail of all flow operations
- 🎨 **Development UI**: Visual flow diagrams, timeline, and scheduling
- 🔌 **Worker Context**: Rich runtime with state, logging, and events
- 📦 **Auto-discovery**: Filesystem-based worker registry
- 🚀 **Horizontal Scaling**: Stateless architecture for easy scaling
- 🔍 **Full Observability**: Real-time logs, metrics, and event streams

## 📖 Status

**Current Version**: v0.4.0 (Active Development)

✅ Core queue and flow functionality  
✅ Event sourcing with Redis Streams  
✅ Real-time monitoring UI with Vue Flow diagrams  
✅ Flow scheduling (cron patterns and delays)  
✅ Worker context with state, logging, and events  
✅ Auto-discovery and flow analysis  
🚧 Comprehensive trigger system (planned v0.5)  
🚧 Python workers (planned v0.5)  
🚧 Postgres adapters (planned v0.6)

See [specs/roadmap.md](./specs/roadmap.md) for planned features.

## 🚀 Quick Start

### Installation

```sh
npx nuxi@latest module add nuxt-queue
```

### Configuration

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['nuxt-queue'],
  queue: {
    ui: true,  // Enable dev UI
    redis: {
      host: '127.0.0.1',
      port: 6379,
    },
  },
})
```

### Create Your First Worker

```typescript
// server/queues/example/process.ts
export default defineQueueWorker(async (job, ctx) => {
  // Access job data
  const { message } = job.data
  
  // Log to stream
  ctx.logger.log('info', 'Processing message', { message })
  
  // Store state
  await ctx.state.set('processedAt', new Date().toISOString())
  
  // Return result
  return { success: true, processed: message }
})

export const config = defineQueueConfig({
  concurrency: 5,
})
```

### Enqueue a Job

```typescript
// API route or wherever
const queueProvider = useQueueProvider()
await queueProvider.enqueue('process', {
  name: 'process',
  data: { message: 'Hello World' }
})
```

### Create a Flow

Multi-step workflows with event-driven orchestration:

```typescript
// server/queues/my-flow/start.ts
export default defineQueueWorker(async (job, ctx) => {
  ctx.logger.log('info', 'Flow started')
  const prepared = { step: 1, data: job.data }
  
  // Emit event to trigger next steps
  ctx.flow.emit('data.prepared', prepared)
  
  return prepared
})

export const config = defineQueueConfig({
  flow: {
    names: ['my-flow'],
    role: 'entry',
    step: 'start',
    emits: ['data.prepared']
  }
})

// server/queues/my-flow/process.ts
export default defineQueueWorker(async (job, ctx) => {
  const result = await processData(job.data)
  
  // Emit to trigger next step
  ctx.flow.emit('data.processed', result)
  
  return result
})

export const config = defineQueueConfig({
  flow: {
    names: ['my-flow'],
    role: 'step',
    step: 'process',
    subscribes: ['data.prepared'],  // Triggered by start
    emits: ['data.processed']
  }
})

// server/queues/my-flow/validate.ts
export default defineQueueWorker(async (job, ctx) => {
  const validated = await validate(job.data)
  ctx.flow.emit('validation.complete', validated)
  return validated
})

export const config = defineQueueConfig({
  flow: {
    names: ['my-flow'],
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

Access the built-in UI at `http://localhost:3000/__queue` (or use the `<QueueApp />` component):

- 📊 **Dashboard**: Overview of queues and flows
- 🔄 **Flow Diagrams**: Visual representation with Vue Flow
- ⏰ **Flow Scheduling**: Create and manage cron-based or delayed schedules
- 📝 **Event Timeline**: Real-time event stream with step details
- 📋 **Logs**: Filtered logging by flow/step
- 📈 **Metrics**: Queue statistics and performance
- 🔍 **Flow Runs**: Complete history with status tracking

## 🏗️ Architecture

### Event Sourcing

Every flow operation is stored as an event in Redis Streams:

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

### Real-time Distribution

Events are broadcast via Redis Pub/Sub for instant UI updates (<100ms latency).

### Worker Context

Every worker receives a rich context:

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
  }
}
```

## 📚 Documentation

### v0.4 Documentation
- **[Current Implementation](./specs/v0.4/current-implementation.md)** - Complete architecture
- **[Event Schema](./specs/v0.4/event-schema.md)** - Event types and structure
- **[Flow Scheduling](./specs/v0.4/flow-scheduling.md)** - Scheduling specification
- **[Quick Reference](./specs/v0.4/quick-reference.md)** - API patterns

### Roadmap & Future
- **[Roadmap](./specs/roadmap.md)** - Planned features across versions
- **[v0.5 Trigger System](./specs/v0.5/trigger-system.md)** - Next-gen event handling
- **[v0.6 Multi-language Workers](./specs/v0.6/multi-language-workers.md)** - Python support
- **[v0.6 Postgres Backend](./specs/v0.6/postgres-backend.md)** - PgBoss integration

## 🔮 Roadmap

### v0.4 (Current - November 2025)
✅ Core queue and flow orchestration  
✅ Event sourcing with Redis Streams  
✅ Real-time monitoring UI  
✅ Flow scheduling (cron and delays)  
✅ Worker context with state and logging  

### v0.5
- 🎯 Comprehensive trigger system (schedule, webhook, event, manual)
- ⏱️ Await patterns (time, event, condition)
- 🐍 Python worker support with RPC bridge
- 🔗 Webhook triggers with auto-setup

### v0.6
- 🐘 PgBoss queue provider option
- 🗄️ Postgres stream store adapter
- 🔄 Unified state and event storage
- 📊 Advanced state management

### v0.7
- 📊 Enhanced logger with multiple adapters
- 🌐 HTTP mode for workers (REST/gRPC)
- 🔌 External service hooks
- 🎨 Pluggable worker execution modes

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