# Lean Event Architecture (v0.3) - Complete Package

This directory contains the complete specification for the v0.3 "Lean Event Architecture" - a radical simplification of the event storage and real-time distribution system with **generic support for flows, triggers, webhooks, and any future event sources**.

**Key Change**: Queue/job events are handled by BullMQ/PgBoss, NOT by this stream store. This system is for internal event sourcing (flows, triggers, etc.).

## 📚 Documents

1. **[lean-event-architecture.md](./lean-event-architecture.md)** ⭐️ START HERE
   - Complete architecture specification
   - Design principles and rationale
   - Storage model with examples
   - Real-time distribution via Pub/Sub
   - Performance targets

2. **[lean-event-architecture-implementation.md](./lean-event-architecture-implementation.md)**
   - Concrete code examples
   - Step-by-step implementation guide
   - Migration checklist
   - Performance testing scripts

3. **[architecture-comparison.md](./architecture-comparison.md)**
   - Side-by-side comparison: v0.2 vs v0.3
   - Performance metrics
   - Code complexity analysis
   - Migration effort estimate
   - Decision matrix

4. **[quick-reference.md](./quick-reference.md)** 📋 QUICK START
   - One-page summary
   - Visual diagrams
   - Key metrics
   - Implementation checklist

## 🎯 What's New in v0.3

### The Big Changes

| Aspect | v0.2 (Current) | v0.3 (Lean) |
|--------|----------------|-------------|
| **Streams per flow** | 5 streams | 1 stream |
| **Storage per run** | 9-16 KB | 5-10 KB |
| **Real-time method** | XREAD polling | Redis Pub/Sub |
| **Update latency** | 1-10 seconds | <100ms |
| **Code complexity** | 288 lines (wiring) | 40 lines (wiring) |
| **Horizontal scaling** | Difficult | Native |
| **Retry & Await** | Limited | Full support |

### Key Benefits

✅ **40-60% less storage** - Lower Redis costs  
✅ **4x faster writes** - Better throughput  
✅ **10-100x faster updates** - Real-time UI like Motia  
✅ **4x better scaling** - Stateless instances  
✅ **70% less code** - Easier to maintain  
✅ **Zero CPU when idle** - No polling loops  
✅ **Automatic retry** - Exponential backoff built-in  
✅ **Flow await patterns** - Time, event, and webhook-based pausing  

## 🚀 Quick Start

### 1. Read the Spec (10 minutes)

Start with [quick-reference.md](./quick-reference.md) for a visual overview, then read [lean-event-architecture.md](./lean-event-architecture.md) for the complete picture.

### 2. Review the Comparison (5 minutes)

Check [architecture-comparison.md](./architecture-comparison.md) to understand the improvements and migration effort.

### 3. Follow the Implementation Guide (1-2 weeks)

Use [lean-event-architecture-implementation.md](./lean-event-architecture-implementation.md) for step-by-step code examples.

## 🏗️ Architecture Overview

```
┌─────────────┐         ┌──────────────┐        ┌─────────────────┐
│   Worker    │  emit   │  Event Bus   │ write  │  Redis Streams  │
│  (Node.js)  ├────────>│  (Internal)  ├───────>│  Single Stream  │
└─────────────┘         └──────────────┘        │  per Flow Run   │
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

### The Core Principle

**One stream per flow** (`nq:flow:<flowId>`) contains EVERYTHING:
- Flow lifecycle events
- Step attempts and completions
- Logs and state changes
- All in chronological order

**Redis Pub/Sub** handles real-time distribution:
- Write once (XADD)
- Publish once (PUBLISH)
- Receive everywhere (<100ms)

**Client-side reduction** (Motia pattern):
- Receive all events
- Compute current state
- Update UI reactively

## 📦 Storage Model

### Before (v0.2): Complex
```
Per Flow Run:
├── nq:flow:<flowId>                        (~5-10 KB)
├── nq:proj:flow:<flowName>:<flowId>        (~2-3 KB)
├── nq:proj:flow-steps:<flowId>             (~1-2 KB)
├── nq:proj:flow-step-index:<flowId>        (~500 bytes)
└── nq:proj:flow-runs:<flowName>            (~100 bytes)

Total: 9-16 KB, 5 streams per run
```

### After (v0.3): Simple
```
Per Flow Run:
├── nq:flow:<flowId>                        (~5-10 KB)
└── ZADD nq:flows:<flowName> <ts> <flowId>  (~100 bytes)

Total: 5-10 KB, 1 stream + 1 index entry
```

## 🔄 Event Schema

### Simplified Envelope

```typescript
{
  id: "1719667845123-0",           // Redis Stream ID
  ts: "2025-10-28T12:34:56Z",      // ISO timestamp
  kind: "step.completed",           // Event type
  subject: "abc-123-def",           // Context ID (flowId, triggerId, etc.)
  flow: "abc-123-def",              // Flow run ID (optional, for flow events)
  step: "fetch_data",               // Step name (optional, for step events)
  trigger: "approval-123",          // Trigger ID (optional, for trigger events)
  data: { result: {...} },          // Payload
  meta: { attempt: 1 }              // Context (optional)
}
```

**Changes from v0.2**:
- **Added `subject`** (required) - primary context identifier
- **Made `flow` optional** - not all events are flow-related
- **Added `trigger`** - for trigger events
- **Added `correlationId`** - link events across contexts
- Removed `stream` (redundant)
- Removed `v` (version at adapter level)

**New event kinds**:
- `trigger.registered/fired/timeout/cancelled` - Trigger lifecycle
- `step.retry` - Retry after failure
- `step.await.time/event/trigger` - Pause execution
- `step.resumed` - Resume after await
- `step.await.timeout` - Await timeout

## 📊 Performance Targets

| Metric | Target | Expected |
|--------|--------|----------|
| Write latency | <5ms | 2-3ms |
| Read latency | <10ms | 5-8ms |
| Update latency | <100ms | 50-80ms |
| Storage/run | <20KB | ~10KB |
| CPU/client (idle) | <0.1% | ~0% |
| Horizontal scaling | ✅ Yes | ✅ Yes |
| Retry reliability | >99.9% | ✅ Yes |
| Await accuracy | ±100ms | ✅ Yes |

## 🛠️ Implementation Checklist

### Phase 1: Foundation (Week 1)
- [ ] Update event types (EventRecord)
- [ ] Add Pub/Sub to Redis adapter
- [ ] Create simplified wiring (flowWiring.ts)
- [ ] Add flow index (ZADD)

### Phase 2: Endpoints (Week 2)
- [ ] Update SSE endpoints (backfill + subscribe)
- [ ] Add reducer composables
- [ ] Add retry logic with exponential backoff
- [ ] Implement await methods (time/event/trigger)
- [ ] Add trigger API endpoint
- [ ] Test real-time updates

### Phase 3: Migration (Week 3)
- [ ] Feature flag (`LEAN_EVENTS=1`)
- [ ] Gradual rollout (10% → 100%)
- [ ] Monitor metrics
- [ ] Performance testing

### Phase 4: Cleanup (Week 4)
- [ ] Remove old projection wiring
- [ ] Delete unused streams
- [ ] Update documentation
- [ ] Celebrate 🎉

## 🧪 Testing

### Unit Tests
```bash
# Test Redis Pub/Sub
node specs/test-pubsub.js

# Test event reduction
npm run test src/runtime/app/composables/useFlowState.test.ts
```

### Integration Tests
```bash
# Start flow and watch events
curl http://localhost:3000/api/_flows/example-flow/start
curl http://localhost:3000/api/_flows/example-flow/runs/<id>/stream

# Should see real-time events with <100ms latency
```

### Load Tests
```bash
# Simulate 100 concurrent flows
node specs/test-load.js

# Check:
# - Write latency < 5ms
# - Pub/Sub delivery < 100ms
# - No memory leaks
```

## 📖 Related Documents

- [message-and-streams-spec.md](./message-and-streams-spec.md) - Original v0.2 spec (historical reference)
- [motia-inspired-design.md](./motia-inspired-design.md) - Original Motia-inspired architecture

## 🤝 Contributing

When implementing v0.3:

1. **Follow the spec** - Don't deviate without discussion
2. **Test thoroughly** - Real-time systems are tricky
3. **Monitor metrics** - Watch latency and throughput
4. **Document changes** - Update this README

## ❓ FAQ

**Q: Why Pub/Sub instead of XREAD?**  
A: Pub/Sub is event-driven (zero CPU when idle) and scales horizontally (Redis handles fanout). XREAD requires polling loops per connection.

**Q: What if I need projections for performance?**  
A: Cache reduced snapshots in Redis with TTL. Most queries are fast enough without caching.

**Q: How do I query logs for a specific step?**  
A: Client filters: `events.filter(e => e.step === 'fetch' && e.kind === 'log')`

**Q: What about large flows (1000+ events)?**  
A: Client reduces incrementally. Server can paginate backfill. Rarely an issue in practice.

**Q: How do retries work?**  
A: Configure retry policy with attempts and backoff. Steps automatically retry on retriable errors with exponential backoff.

**Q: Can steps wait for external triggers?**  
A: Yes! Use `ctx.await.trigger()` to pause execution until webhook is called. Also supports time-based and event-based await.

**Q: What happens if an await times out?**  
A: A `step.await.timeout` event is emitted and the step fails. You can handle timeouts in your error handling logic.

**Q: Can I mix v0.2 and v0.3?**  
A: Yes, use a feature flag. They can coexist during migration.

## 📞 Support

Questions? Open an issue or ping @DevJoghurt on GitHub.

---

**Status**: ✅ **Ready to implement**  
**Version**: v0.3 (2025-10-29)  
**Author**: @DevJoghurt  
**License**: MIT
