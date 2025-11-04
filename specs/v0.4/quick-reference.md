# Quick Reference: Nuxt Queue v0.4

## One-Page Summary

### Core Concept
**Event-sourced flows + BullMQ queues + Real-time monitoring = Production-ready orchestration**

---

## Storage Model

```
┌─────────────────────────────────────────────────────────┐
│  Redis Streams (Event Timeline)                         │
│                                                          │
│  nq:flow:<runId>                                        │
│  ├─ flow.start      { input }                           │
│  ├─ step.started    { stepName: "fetch" }               │
│  ├─ log             { level: "info", message: "..." }   │
│  ├─ step.completed  { stepName: "fetch", result }       │
│  ├─ step.started    { stepName: "process" }             │
│  ├─ log             { level: "info", message: "..." }   │
│  ├─ step.completed  { stepName: "process" }             │
│  └─ flow.completed  { duration: 2050 }                  │
│                                                          │
│  ~5-15 KB per run (depends on number of events)         │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  Redis Sorted Set (Flow Index)                          │
│                                                          │
│  nq:flows:<flowName>                                    │
│  ├─ 1719667800000 → runId-1                             │
│  ├─ 1719667850000 → runId-2                             │
│  └─ 1719667900000 → runId-3                             │
│                                                          │
│  ~100 bytes per run, for listing                        │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  BullMQ Queues (Job Management)                         │
│                                                          │
│  bull:<queueName>:*                                     │
│  ├─ wait                                                 │
│  ├─ active                                               │
│  ├─ completed                                            │
│  └─ failed                                               │
└─────────────────────────────────────────────────────────┘
```

---

## Real-time Distribution

```
┌──────────┐         ┌──────────────┐         ┌───────────┐
│  Worker  │  emit   │  Event Bus   │  write  │  Redis    │
│ (Step 1) ├────────>│  (Internal)  ├────────>│  Streams  │
└──────────┘         └──────────────┘         └─────┬─────┘
                                                     │
                                            XADD + PUBLISH
                                                     │
                                              ┌──────▼──────┐
                                              │ Redis Pub/  │
                                              │    Sub      │
                                              └──────┬──────┘
                                                     │
                                      ┌──────────────┴──────────────┐
                                      │                             │
                               ┌──────▼──────┐             ┌────────▼─────┐
                               │ Instance 1  │             │ Instance N   │
                               │   SSE/WS    │             │   SSE/WS     │
                               └──────┬──────┘             └──────┬───────┘
                                      │                           │
                               ┌──────▼──────┐             ┌──────▼───────┐
                               │  Client 1   │             │  Client N    │
                               │  (Browser)  │             │  (Browser)   │
                               └─────────────┘             └──────────────┘
```

**Key**: Write once (XADD), broadcast instantly (PUBLISH), receive everywhere (<100ms)

---

## Event Schema (v0.4)

```typescript
{
  id: "1719667845123-0",          // Redis Stream ID (auto)
  ts: "2025-10-30T12:34:56Z",     // ISO timestamp (auto)
  type: "step.completed",          // Event type
  runId: "abc-123-def",            // Flow run UUID
  flowName: "example-flow",        // Flow definition name
  stepName?: "fetch_data",         // Step name (optional)
  stepId?: "step-1",               // Step ID (optional)
  attempt?: 1,                     // Attempt number (optional)
  data?: { result: {...} }         // Payload (optional)
}
```

**Required fields**: `type`, `runId`, `flowName`  
**Optional fields**: `stepName`, `stepId`, `attempt`, `data`

---

## Event Types

```typescript
// Flow lifecycle
'flow.start'         // Flow started
'flow.completed'     // Flow completed successfully
'flow.failed'        // Flow failed

// Step lifecycle
'step.started'       // Step execution started
'step.completed'     // Step completed successfully
'step.failed'        // Step failed
'step.retry'         // Step retrying after failure

// Observability
'log'                // Log entry from worker
'emit'               // Custom event from worker
'state'              // State operation (get/set/delete)
```

---

## Worker Development

### Basic Worker
```typescript
// server/queues/my-queue/my-worker.ts
export default defineQueueWorker(async (job, ctx) => {
  // Job data
  const input = job.data
  
  // Logging
  ctx.logger.log('info', 'Processing', { input })
  
  // State
  await ctx.state.set('status', 'processing')
  
  // Return result
  return { success: true }
})

export const config = defineQueueConfig({
  concurrency: 5,
  flow: {
    names: ['my-flow'],
    role: 'step',
    step: 'my-worker',
    emits: ['work.done']
  }
})
```

### Flow Entry Point
```typescript
export default defineQueueWorker(async (job, ctx) => {
  ctx.logger.log('info', 'Flow started')
  const prepared = { prepared: job.data }
  
  // Emit to trigger subscribed steps
  ctx.flow.emit('data.ready', prepared)
  
  return prepared
})

export const config = defineQueueConfig({
  flow: {
    names: ['my-flow'],
    role: 'entry',
    step: 'start',
    emits: ['data.ready']  // Steps subscribing to this will be triggered
  }
})
```

### Flow Step
```typescript
export default defineQueueWorker(async (job, ctx) => {
  const data = job.data
  const processed = await transform(data)
  
  // Emit to trigger next steps
  ctx.flow.emit('transform.complete', processed)
  
  return processed
})

export const config = defineQueueConfig({
  flow: {
    names: ['my-flow'],
    role: 'step',
    step: 'transform',
    subscribes: ['data.ready'],      // Triggered by entry point
    emits: ['transform.complete']    // Triggers final step
  }
})
```

---

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
    state: {
      name: 'redis',
      namespace: 'nq',
      autoScope: 'always',
      cleanup: {
        strategy: 'never',  // 'immediate' | 'ttl' | 'on-complete'
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
  concurrency: 5,
  limiter: {
    max: 100,
    duration: 60000
  },
  flow: {
    names: ['flow-name'],           // Flow(s) this step belongs to
    role: 'entry' | 'step',         // Entry or regular step
    step: 'step_name',              // This step's name
    emits: ['event.name'],          // Events this emits
    subscribes: ['other.event']     // Events this subscribes to
  }
})
```

---

## Questions?

**Q: What's the difference between queue and flow?**  
A: Queues handle individual jobs. Flows orchestrate multi-step workflows.

**Q: How do I scale workers?**  
A: Run multiple instances pointing to same Redis. Workers auto-balance.

**Q: Can I use without flows?**  
A: Yes! Just create workers without flow config.

**Q: How does real-time work?**  
A: Events written to Redis Streams + published via Pub/Sub to SSE clients.

**Q: What about Python workers?**  
A: Planned for v0.5 with RPC process manager.

**Q: Where's the data stored?**  
A: Events in Redis Streams, state in Redis (via Nitro storage), jobs in BullMQ.

---

## Next Steps

1. Read [v0.4-current-implementation.md](./v0.4-current-implementation.md) for complete docs
2. Check [roadmap.md](./roadmap.md) for planned features
3. Try the examples in `/playground/`
4. Join discussions on GitHub

**Let's build! 🚀**
