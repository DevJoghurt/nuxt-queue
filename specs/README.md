# Nuxt Queue Architecture (v0.4) - Current Implementation

This directory contains the complete specification for v0.4 - the current implementation of nuxt-queue, a BullMQ-based queue and flow orchestration system for Nuxt with integrated event sourcing and real-time monitoring.

**Core Architecture**: Stream-based event sourcing with Redis Pub/Sub for real-time distribution, BullMQ for queue management, and a unified flow orchestration engine.

## 📚 Documents

1. **[v0.4-current-implementation.md](./v0.4-current-implementation.md)** ⭐️ START HERE
   - Complete architecture specification
   - Event sourcing with stream store
   - Flow orchestration engine
   - Real-time distribution via Redis Pub/Sub
   - Worker context and runtime

2. **[v0.4-event-schema.md](./v0.4-event-schema.md)** 📋 EVENTS
   - Event types and schema
   - Flow lifecycle events
   - Step execution events
   - State and logging

3. **[roadmap.md](./roadmap.md)** 🗺️ FUTURE
   - Next steps and vision
   - Planned features
   - Architecture improvements
   - Migration paths

4. **[quick-reference.md](./quick-reference.md)** � QUICK REFERENCE
   - API overview
   - Key concepts
   - Common patterns

## 🎯 What's in v0.4

### Current Features

✅ **Stream-based Event Sourcing** - Single stream per flow run with full event history  
✅ **Real-time Distribution** - Redis Pub/Sub for <100ms update latency  
✅ **Flow Orchestration** - Define multi-step workflows with TypeScript  
✅ **BullMQ Integration** - Reliable queue management with retry support  
✅ **Worker Context** - Rich runtime context with state, logging, and emit  
✅ **Registry System** - Auto-discovery of queues and flows from filesystem  
✅ **Horizontal Scaling** - Stateless architecture, scale workers independently  
✅ **Development UI** - Real-time monitoring with Vue Flow diagrams  
✅ **State Management** - Per-flow state with Redis backend  
✅ **Metrics & Logging** - Integrated observability  

## 🚀 Quick Start

### 1. Read Current Implementation (15 minutes)

Start with [v0.4-current-implementation.md](./v0.4-current-implementation.md) for architecture overview and [v0.4-event-schema.md](./v0.4-event-schema.md) for event details.

### 2. Check the Roadmap (5 minutes)

See [roadmap.md](./roadmap.md) to understand planned features and improvements.

### 3. Use the Quick Reference

Use [quick-reference.md](./quick-reference.md) for API patterns and common use cases.

## 🏗️ Architecture Overview

```
┌─────────────┐         ┌──────────────┐        ┌─────────────────┐
│   Worker    │  emit   │  Event Bus   │ write  │  Redis Streams  │
│  (Node.js)  ├────────>│  (Internal)  ├───────>│  per Flow Run   │
└─────────────┘         └──────────────┘        │  nq:flow:<id>   │
                               │                 └────────┬────────┘
                               │                          │
                               ▼                   XADD + PUBLISH
                        ┌──────────────┐                  │
                        │ Redis PubSub │<─────────────────┘
                        │  (Realtime)  │
                        └──────┬───────┘
                               │
                 ┌─────────────┴─────────────┐
                 ▼                           ▼
          ┌─────────────┐            ┌─────────────┐
          │ Instance 1  │            │ Instance N  │
          │   SSE/WS    │            │   SSE/WS    │
          └──────┬──────┘            └──────┬──────┘
                 │                          │
          ┌──────▼──────┐            ┌──────▼──────┐
          │  Client 1   │            │  Client N   │
          │  (Browser)  │            │  (Browser)  │
          └─────────────┘            └─────────────┘
```

### Core Principles

**Event Sourcing**: One stream per flow run (`nq:flow:<runId>`) contains all events in chronological order.

**Real-time Distribution**: Redis Pub/Sub broadcasts events to all subscribed instances with <100ms latency.

**Flow Orchestration**: Multi-step workflows defined as queue workers, executed by BullMQ.

**Worker Context**: Rich runtime with state management, logging, event emission, and flow control.

**Client-side Reduction**: Browser receives events and computes current state reactively.

## 📦 Storage Model

### Current (v0.4)

```
Per Flow Run:
├── nq:flow:<runId>                             (~5-15 KB, depends on events)
│   ├─ flow.start
│   ├─ step.started
│   ├─ log
│   ├─ step.completed
│   └─ flow.completed
│
└── Flow Index: nq:flows:<flowName>             (~100 bytes per entry)
    └─ ZADD <timestamp> <runId>

Plus BullMQ queues for job management:
└── bull:<queueName>:*                          (handled by BullMQ)
```

## 🔄 Event Schema (v0.4)

### Current Event Structure

```typescript
{
  id: "1719667845123-0",          // Redis Stream ID (auto-generated)
  ts: "2025-10-28T12:34:56Z",     // ISO timestamp (auto-generated)
  type: "step.completed",          // Event type
  runId: "abc-123-def",            // Flow run UUID
  flowName: "example-flow",        // Flow definition name
  stepName?: "fetch_data",         // Step name (optional, for step events)
  stepId?: "step-1",               // Step ID (optional, for step events)
  attempt?: 1,                     // Attempt number (optional, for step events)
  data?: { result: {...} }         // Event payload (optional)
}
```

**Key fields**:
- `id` - Redis stream ID (auto)
- `ts` - ISO timestamp (auto)
- `type` - Event type (required)
- `runId` - Flow run UUID (required)
- `flowName` - Flow name (required)
- `stepName`, `stepId`, `attempt` - Optional for step events
- `data` - Optional payload

## 📊 Current Capabilities

| Feature | Status |
|---------|--------|
| Stream-based events | ✅ Implemented |
| Redis Pub/Sub real-time | ✅ Implemented |
| Flow orchestration | ✅ Implemented |
| BullMQ integration | ✅ Implemented |
| TypeScript workers | ✅ Implemented |
| Worker context (state/logs) | ✅ Implemented |
| Development UI | ✅ Implemented |
| Horizontal scaling | ✅ Supported |
| Event streaming API | ✅ Implemented |
| Registry auto-discovery | ✅ Implemented |
| Python workers | 🚧 Planned |
| Trigger/await patterns | 🚧 Planned |
| PgBoss provider | 🚧 Planned |
| Postgres stream store | 🚧 Planned |
| Unified state/stream | 🚧 Planned |

## 🛠️ Current Architecture Components

### Module System
- **Registry**: Auto-discovers queues and flows from filesystem
- **Compilation**: Builds static registry at build time, hot-reloads in dev
- **Templates**: Generates type-safe imports for worker handlers

### Runtime
- **Event Manager**: Publishes events to stream store and internal bus
- **Stream Store**: Redis Streams adapter with Pub/Sub for real-time
- **State Provider**: Redis-backed state management with flow scoping
- **Queue Provider**: BullMQ integration for job management
- **Worker Runner**: Executes steps with rich context

### API Endpoints
- `GET /api/_flows/:name/runs` - List flow runs
- `GET /api/_flows/:name/runs/:id` - Get flow run events
- `GET /api/_flows/:name/runs/:id/stream` - SSE stream of events
- `POST /api/_flows/:name/start` - Start flow run
- `GET /api/_queues/:name` - Queue information
- `POST /api/_queues/:name/enqueue` - Enqueue job

### UI Components
- Flow diagram visualization (Vue Flow)
- Real-time event timeline
- Flow run overview and logs
- Queue statistics and monitoring

## 🧪 Testing

### Development
```bash
# Run tests
yarn test

# Start development server
yarn dev

# Access UI
http://localhost:3000/__queue
```

### Example Flow
```typescript
// server/queues/example/first_step.ts
export default defineQueueWorker(async (job, ctx) => {
  ctx.logger.log('info', 'Starting step 1')
  await ctx.state.set('step1Result', { success: true })
  
  // Emit event to trigger next step
  ctx.emit({ type: 'emit', data: { name: 'step1.complete', result: { message: 'Step 1 complete' } } })
  
  return { message: 'Step 1 complete' }
})

export const config = defineQueueConfig({
  flow: {
    names: ['example-flow'],
    role: 'entry',
    step: 'first_step',
    emits: ['step1.complete']
  }
})

// server/queues/example/second_step.ts
export default defineQueueWorker(async (job, ctx) => {
  ctx.logger.log('info', 'Running step 2')
  return { message: 'Step 2 complete' }
})

export const config = defineQueueConfig({
  flow: {
    names: ['example-flow'],
    role: 'step',
    step: 'second_step',
    subscribes: ['step1.complete']  // Triggered by first_step
  }
})
```

## 📖 Related Documents

- [v0.4-current-implementation.md](./v0.4-current-implementation.md) - Complete architecture documentation
- [v0.4-event-schema.md](./v0.4-event-schema.md) - Event types and schema
- [roadmap.md](./roadmap.md) - Future plans and vision
- [quick-reference.md](./quick-reference.md) - API quick reference

### Historical References
- [lean-event-architecture.md](./lean-event-architecture.md) - v0.3 design (historical)
- [message-and-streams-spec.md](./message-and-streams-spec.md) - v0.2 spec (historical)
- [motia-inspired-design.md](./motia-inspired-design.md) - Original inspiration

## 🤝 Contributing

When working on nuxt-queue:

1. **Follow the architecture** - Use stream store for events, BullMQ for jobs
2. **Test thoroughly** - Real-time systems require careful testing
3. **Document changes** - Keep specs in sync with implementation
4. **Consider performance** - Monitor latency and throughput

## ❓ FAQ

**Q: What's the difference between queue and flow?**  
A: Queues handle individual jobs via BullMQ. Flows orchestrate multi-step workflows where steps are queued and tracked via event sourcing.

**Q: How do I add a new flow?**  
A: Create worker files in `server/queues/<flow-name>/` with `defineQueueWorker()` and `defineQueueConfig()`. The registry auto-discovers them.

**Q: How does real-time work?**  
A: Events are written to Redis Streams and published via Pub/Sub. SSE endpoints subscribe to Pub/Sub channels for instant updates.

**Q: Can I use this without flows?**  
A: Yes! You can use just the queue functionality with BullMQ for simple job processing.

**Q: How do I access state in a worker?**  
A: Use `ctx.state.get()` and `ctx.state.set()`. State is automatically scoped per flow run.

**Q: What about Python workers?**  
A: Planned for future release. Currently TypeScript/JavaScript only.

## 📞 Support

Questions? Open an issue or check the documentation in `/specs/`.

---

**Status**: ✅ **v0.4 - Current Implementation**  
**Version**: v0.4.0  
**Author**: @DevJoghurt  
**License**: MIT
