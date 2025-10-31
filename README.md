# Nuxt Queue

Event-sourced queue and flow orchestration for Nuxt. Built on BullMQ with integrated real-time monitoring and multi-step workflow support.

## ✨ Features

- 🔄 **Queue Management**: Reliable job processing with BullMQ
- 🎭 **Flow Orchestration**: Multi-step workflows with event sourcing
- ⚡ **Real-time Updates**: Redis Pub/Sub for <100ms latency monitoring
- 📊 **Event Sourcing**: Complete audit trail of all flow operations
- 🎨 **Development UI**: Visual flow diagrams with Vue Flow
- 🔌 **Worker Context**: Rich runtime with state, logging, and events
- 📦 **Auto-discovery**: Filesystem-based worker registry
- 🚀 **Horizontal Scaling**: Stateless architecture for easy scaling
- 🔍 **Full Observability**: Real-time logs, metrics, and event streams

## 📖 Status

**Current Version**: v0.4.0 (Active Development)

✅ Core queue and flow functionality implemented  
✅ Event sourcing with Redis Streams  
✅ Real-time monitoring UI  
🚧 Python workers (planned v0.5)  
🚧 Trigger/await patterns (planned v0.5)  
🚧 Postgres adapters (planned v0.6)

See [roadmap](./specs/roadmap.md) for planned features.

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
  
  // Emit custom event
  ctx.emit({ type: 'message.processed', data: { message } })
  
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
  ctx.emit({ type: 'emit', data: { name: 'data.prepared', ...prepared } })
  
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
  
  // Emit to trigger validation step
  ctx.emit({ type: 'emit', data: { name: 'data.processed', result } })
  
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
  ctx.emit({ type: 'emit', data: { name: 'validation.complete', validated } })
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

## 🎨 Development UI

Access the built-in UI at `http://localhost:3000/__queue` (or use the `<QueueApp />` component):

- 📊 **Dashboard**: Overview of queues and flows
- 🔄 **Flow Diagrams**: Visual representation with Vue Flow
- 📝 **Event Timeline**: Real-time event stream
- 📋 **Logs**: Filtered logging by flow/step
- 📈 **Metrics**: Queue statistics and performance

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
  emit(event)                // Emit custom events
  flow: {
    startFlow(name, input)   // Start nested flow
  }
}
```

## 📚 Documentation

- **[v0.4 Current Implementation](./specs/v0.4-current-implementation.md)** - Complete architecture
- **[Event Schema](./specs/v0.4-event-schema.md)** - Event types and structure
- **[Roadmap](./specs/roadmap.md)** - Planned features
- **[Quick Reference](./specs/quick-reference.md)** - API patterns

## 🔮 Roadmap

### v0.5 (Q1 2026)
- ⏱️ Await patterns (time, event, trigger)
- 🔗 Webhook triggers with auto-setup
- 🐍 Python worker support with RPC

### v0.6 (Q2 2026)
- 🐘 PgBoss queue provider
- 🗄️ Postgres stream store adapter
- 🔄 Unified state and event storage

### v0.7 (Q3 2026)
- 📊 Enhanced logger with multiple adapters
- 🌐 HTTP mode for workers
- 🔌 External service hooks

See [roadmap.md](./specs/roadmap.md) for details.

## 🤝 Contributing

Contributions welcome! Please read our architecture docs first:

1. Review [v0.4-current-implementation.md](./specs/v0.4-current-implementation.md)
2. Check [roadmap.md](./specs/roadmap.md) for planned features
3. Open an issue to discuss changes
4. Submit a PR with tests

## 📄 License

[MIT License](./LICENSE) - Copyright (c) DevJoghurt