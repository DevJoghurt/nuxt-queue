# Nuxt Queue: Lean Event Architecture (v0.3)

**Goal**: Minimize storage overhead, eliminate duplication, enable real-time multi-instance scaling with a Motia-like UI, while maintaining complete event history for flows, triggers, and other internal processes.

**Principle**: **One stream per context** + **Redis Pub/Sub for real-time distribution** = Simple, scalable, efficient.

**Note**: Queue/job events are handled by BullMQ/PgBoss, NOT by this stream store. This system is for flows, triggers, webhooks, and other internal event sourcing needs.

---

## 1. Architecture Overview

```
┌─────────────┐         ┌──────────────┐        ┌─────────────────┐
│   Worker    │ emit    │  Event Bus   │        │  Redis Streams  │
│  (Node.js)  ├────────>│  (Internal)  ├───────>│  Single Stream  │
└─────────────┘         └──────────────┘        │  per Context    │
                               │                 └────────┬────────┘
                               │                          │
                               ▼                          │ XREAD
                        ┌──────────────┐                  │
                        │ Redis PubSub │<─────────────────┘
                        │  (Realtime)  │        on append
                        └──────┬───────┘
                               │
                 ┌─────────────┴─────────────┐
                 ▼                           ▼
          ┌─────────────┐            ┌─────────────┐
          │  Instance 1 │            │  Instance N │
          │  SSE/WS     │            │  SSE/WS     │
          └─────────────┘            └─────────────┘
```

### Key Decisions

1. **Single stream per context**: `nq:<type>:<id>` contains EVERYTHING (flows, triggers, webhooks)
2. **No projection streams**: Compute state on read by reducing the single stream
3. **Redis Pub/Sub for fanout**: When events are written, publish to `nq:<type>:<id>:live` channel
4. **Client-side reduction**: UI receives all events and reduces to current state (like Motia)
5. **Server-side caching**: Optional in-memory snapshot cache per instance for performance
6. **Queue/job events separate**: BullMQ/PgBoss handle their own events, not stored here

---

## 2. Event Schema (Generic & Flexible)

### 2.1 Envelope (same for all events)

```typescript
{
  id: string              // Redis Stream ID (e.g., "1719667845123-0")
  ts: string              // ISO 8601 timestamp
  kind: string            // Event type (dot.case, e.g., "flow.started", "trigger.fired")
  subject: string         // Context identifier (flowId, triggerId, webhookId, etc.)
  
  // Optional context-specific fields (use what's relevant)
  flow?: string           // Flow run ID (for flow events)
  step?: string           // Step name (for step events)
  trigger?: string        // Trigger ID (for trigger events)
  correlationId?: string  // Group related events across contexts
  
  data?: object           // Event-specific payload
  meta?: object           // Optional metadata (attempt, jobId, etc.)
}
```

**Design Principles**:
- **`subject`** is the primary identifier - what stream does this belong to?
- **Context fields** (`flow`, `step`, `trigger`) are optional and provide semantic meaning
- **`kind`** defines the event type and can be subscribed to across all subjects
- **Backwards compatible**: Flow events still work as before, but now extensible to triggers, webhooks, etc.

**Changes from v0.2**:
- Removed `stream` (redundant, implicit from context)
- Made `subject` required (was optional) - it's the stream key
- Changed `flow` to optional (not all events are flow-related)
- Added `trigger` for trigger events
- Added `correlationId` for cross-context tracking
- Removed `v` (version at adapter level if needed)
- Kept `step` optional (only for step events)

### 2.2 Event Kinds by Context

#### Flow Lifecycle
```typescript
// Flow started
{ kind: "flow.started", subject: flowId, flow: flowId, data: { name, queue } }

// Flow completed successfully
{ kind: "flow.completed", subject: flowId, flow: flowId, data: { result?, duration? } }

// Flow failed
{ kind: "flow.failed", subject: flowId, flow: flowId, data: { error, duration? } }
```

#### Step Lifecycle
```typescript
// Step attempt started
{ kind: "step.started", subject: flowId, flow: flowId, step, data: { input? }, meta: { attempt: 1, jobId? } }

// Step attempt succeeded
{ kind: "step.completed", subject: flowId, flow: flowId, step, data: { result? }, meta: { attempt: 1, duration? } }

// Step attempt failed (will retry or final)
{ kind: "step.failed", subject: flowId, flow: flowId, step, data: { error, willRetry, nextRetryAt? }, meta: { attempt: 1, maxAttempts?, backoff? } }

// Step retry scheduled (after failure)
{ kind: "step.retry", subject: flowId, flow: flowId, step, data: { reason, delayMs }, meta: { attempt: 2, scheduledAt } }
```

#### Await Patterns (Step Pausing)
```typescript
// Step waiting for time-based condition
{ kind: "step.await.time", subject: flowId, flow: flowId, step, data: { resumeAt, reason? } }

// Step waiting for event trigger
{ kind: "step.await.event", subject: flowId, flow: flowId, step, data: { eventKind, condition?, timeout? } }

// Step waiting for external trigger (webhook, user action)
{ kind: "step.await.trigger", subject: flowId, flow: flowId, step, data: { triggerId, triggerType, payload?, timeout? } }

// Step resumed after await
{ kind: "step.resumed", subject: flowId, flow: flowId, step, data: { reason, awaitDuration }, meta: { awaitType: 'time'|'event'|'trigger' } }

// Step await timeout (if timeout configured)
{ kind: "step.await.timeout", subject: flowId, flow: flowId, step, data: { awaitType, duration } }
```

#### Trigger Events (New)
```typescript
// Trigger registered
{ kind: "trigger.registered", subject: triggerId, trigger: triggerId, data: { type, config }, correlationId: flowId }

// Trigger fired (webhook received, event matched, etc.)
{ kind: "trigger.fired", subject: triggerId, trigger: triggerId, data: { payload, source }, correlationId: flowId }

// Trigger expired (timeout reached)
{ kind: "trigger.timeout", subject: triggerId, trigger: triggerId, data: { duration }, correlationId: flowId }

// Trigger cancelled
{ kind: "trigger.cancelled", subject: triggerId, trigger: triggerId, data: { reason }, correlationId: flowId }
```

#### Logs
```typescript
// Generic log (can be in any context)
{ kind: "log", subject: flowId, flow?: flowId, step?: step, data: { level, msg }, meta: { attempt? } }
```

#### State Updates (Optional)
```typescript
{ kind: "state.set", subject: flowId, flow: flowId, data: { key, value } }
```

---

## 3. Storage: Single Stream per Context

### 3.1 Stream Naming

**Generic pattern**:
```
nq:<type>:<id>
```

**Examples**:
```
nq:flow:<flowId>           // Flow events
nq:trigger:<triggerId>     // Trigger events
nq:webhook:<webhookId>     // Webhook events
nq:global                  // System-wide events (optional)
```

**That's it.** Everything for a given context goes into one stream.

### 3.2 Indexes (Minimal)

To list items by type, maintain **lightweight indexes** in Redis Sorted Sets:

```
ZADD nq:flows:<flowName> <timestamp> <flowId>
ZADD nq:triggers <timestamp> <triggerId>
ZADD nq:webhooks <timestamp> <webhookId>
```

- Score = start/registration timestamp (for chronological ordering)
- Member = context ID
- Enables `ZREVRANGE nq:flows:example-flow 0 49` for recent 50 runs
- Space efficient: ~100 bytes per entry

### 3.3 Example Flow Stream

```
Stream: nq:flow:abc-123-def

1719667800000-0  { kind: "flow.started", subject: "abc-123-def", flow: "abc-123-def", data: { name: "example-flow", queue: "default" } }
1719667800100-0  { kind: "step.started", subject: "abc-123-def", flow: "abc-123-def", step: "fetch_data", meta: { attempt: 1 } }
1719667800150-0  { kind: "log", subject: "abc-123-def", flow: "abc-123-def", step: "fetch_data", data: { level: "info", msg: "Fetching..." } }
1719667800200-0  { kind: "step.failed", subject: "abc-123-def", flow: "abc-123-def", step: "fetch_data", data: { error: "Network timeout", willRetry: true, nextRetryAt: "2025-10-29T12:00:05Z" }, meta: { attempt: 1, maxAttempts: 3, backoff: { type: "exponential", delayMs: 5000 } } }
1719667805200-0  { kind: "step.retry", subject: "abc-123-def", flow: "abc-123-def", step: "fetch_data", data: { reason: "Retry after network timeout", delayMs: 5000 }, meta: { attempt: 2, scheduledAt: "2025-10-29T12:00:05Z" } }
1719667805300-0  { kind: "step.started", subject: "abc-123-def", flow: "abc-123-def", step: "fetch_data", meta: { attempt: 2 } }
1719667806400-0  { kind: "step.completed", subject: "abc-123-def", flow: "abc-123-def", step: "fetch_data", data: { result: {...} }, meta: { attempt: 2, duration: 1100 } }
1719667806500-0  { kind: "step.started", subject: "abc-123-def", flow: "abc-123-def", step: "process_data", meta: { attempt: 1 } }
1719667806600-0  { kind: "log", subject: "abc-123-def", flow: "abc-123-def", step: "process_data", data: { level: "info", msg: "Processing..." } }
1719667807300-0  { kind: "step.completed", subject: "abc-123-def", flow: "abc-123-def", step: "process_data", meta: { attempt: 1, duration: 700 } }
1719667807400-0  { kind: "step.started", subject: "abc-123-def", flow: "abc-123-def", step: "await_approval", meta: { attempt: 1 } }
1719667807500-0  { kind: "step.await.trigger", subject: "abc-123-def", flow: "abc-123-def", step: "await_approval", data: { triggerId: "approval-123", triggerType: "webhook", timeout: 86400000 } }
1719667807600-0  { kind: "log", subject: "abc-123-def", flow: "abc-123-def", step: "await_approval", data: { level: "info", msg: "Waiting for approval webhook..." } }
1719668694500-0  { kind: "step.resumed", subject: "abc-123-def", flow: "abc-123-def", step: "await_approval", data: { reason: "Webhook received", awaitDuration: 886900 }, meta: { awaitType: "trigger" } }
1719668694600-0  { kind: "step.completed", subject: "abc-123-def", flow: "abc-123-def", step: "await_approval", data: { result: { approved: true } }, meta: { attempt: 1, duration: 887100 } }
1719668694700-0  { kind: "flow.completed", subject: "abc-123-def", flow: "abc-123-def", data: { duration: 894700 } }
```

### 3.4 Example Trigger Stream

```
Stream: nq:trigger:approval-123

1719667807500-0  { kind: "trigger.registered", subject: "approval-123", trigger: "approval-123", data: { type: "webhook", url: "/api/_flows/triggers/approval-123", timeout: 86400000 }, correlationId: "abc-123-def" }
1719668694500-0  { kind: "trigger.fired", subject: "approval-123", trigger: "approval-123", data: { payload: { approved: true, comment: "LGTM" }, source: "webhook", ip: "192.168.1.100" }, correlationId: "abc-123-def" }
```
Stream: nq:flow:abc-123-def

1719667800000-0  { kind: "flow.started", flow: "abc-123-def", data: { name: "example-flow", queue: "default" } }
1719667800100-0  { kind: "step.started", flow: "abc-123-def", step: "fetch_data", meta: { attempt: 1 } }
1719667800150-0  { kind: "log", flow: "abc-123-def", step: "fetch_data", data: { level: "info", msg: "Fetching..." } }
1719667800200-0  { kind: "step.failed", flow: "abc-123-def", step: "fetch_data", data: { error: "Network timeout", willRetry: true, nextRetryAt: "2025-10-29T12:00:05Z" }, meta: { attempt: 1, maxAttempts: 3, backoff: { type: "exponential", delayMs: 5000 } } }
1719667805200-0  { kind: "step.retry", flow: "abc-123-def", step: "fetch_data", data: { reason: "Retry after network timeout", delayMs: 5000 }, meta: { attempt: 2, scheduledAt: "2025-10-29T12:00:05Z" } }
1719667805300-0  { kind: "step.started", flow: "abc-123-def", step: "fetch_data", meta: { attempt: 2 } }
1719667806400-0  { kind: "step.completed", flow: "abc-123-def", step: "fetch_data", data: { result: {...} }, meta: { attempt: 2, duration: 1100 } }
1719667806500-0  { kind: "step.started", flow: "abc-123-def", step: "process_data", meta: { attempt: 1 } }
1719667806600-0  { kind: "log", flow: "abc-123-def", step: "process_data", data: { level: "info", msg: "Processing..." } }
1719667807300-0  { kind: "step.completed", flow: "abc-123-def", step: "process_data", meta: { attempt: 1, duration: 700 } }
1719667807400-0  { kind: "step.started", flow: "abc-123-def", step: "await_approval", meta: { attempt: 1 } }
1719667807500-0  { kind: "step.await.trigger", flow: "abc-123-def", step: "await_approval", data: { triggerId: "approval-123", triggerType: "webhook", timeout: 86400000 } }
1719667807600-0  { kind: "log", flow: "abc-123-def", step: "await_approval", data: { level: "info", msg: "Waiting for approval webhook..." } }
1719668694500-0  { kind: "step.resumed", flow: "abc-123-def", step: "await_approval", data: { reason: "Webhook received", awaitDuration: 886900 }, meta: { awaitType: "trigger" } }
1719668694600-0  { kind: "step.completed", flow: "abc-123-def", step: "await_approval", data: { result: { approved: true } }, meta: { attempt: 1, duration: 887100 } }
1719668694700-0  { kind: "flow.completed", flow: "abc-123-def", data: { duration: 894700 } }
```

---

## 4. Real-time Distribution

### 4.1 Redis Pub/Sub Pattern

When an event is appended to any stream (e.g., `nq:flow:<id>`, `nq:trigger:<id>`):

1. **Write to stream**: `XADD nq:<type>:<id> * ...`
2. **Publish to channel**: `PUBLISH nq:<type>:<id>:live <serialized-event>`

### 4.2 Internal Event Bus

The internal bus (in-process EventEmitter) publishes events on TWO channels:

1. **By subject**: `eventBus.subscribeSubject(subject)` - Subscribe to specific context (flowId, triggerId, etc.)
2. **By kind**: `eventBus.onKind(kind)` - Subscribe to event types across all contexts

```typescript
// Subscribe to all events for a specific flow
eventBus.subscribeSubject('abc-123-def', (event) => {
  console.log('Flow event:', event.kind)
})

// Subscribe to all step.completed events across all flows
eventBus.onKind('step.completed', (event) => {
  console.log('Step completed in flow:', event.flow)
})

// Subscribe to all trigger.fired events
eventBus.onKind('trigger.fired', (event) => {
  console.log('Trigger fired:', event.trigger)
})
```

### 4.3 Multi-instance Subscription

Each Node.js instance:

1. **Subscribe to Redis Pub/Sub**: `SUBSCRIBE nq:<type>:<id>:live`
2. **Forward to connected clients**: SSE/WS to browser
3. **No XREAD polling needed**: Pub/Sub provides instant delivery

### 4.4 Client Connection Flow

```typescript
// Client connects to SSE endpoint
GET /api/_events/:type/:id/stream

// Server:
1. Backfill recent events: XREVRANGE nq:<type>:<id> + - COUNT 100
2. Send backfill to client
3. Subscribe to Redis channel: nq:<type>:<id>:live
4. Forward live events to client as they arrive
```

### 4.5 Adapter Interface (Updated)

```typescript
interface StreamAdapter {
  // Write event and publish to Pub/Sub
  append(stream: string, event: Omit<EventRecord, 'id' | 'ts'>): Promise<EventRecord>
  
  // Read historical events
  read(stream: string, opts?: { limit?, fromId?, direction? }): Promise<EventRecord[]>
  
  // Subscribe to BOTH historical (via XREAD) and live (via Pub/Sub)
  subscribe(stream: string, handler: (e: EventRecord) => void): Promise<{ unsubscribe(): void }>
}
```

**Key**: `subscribe()` should use **Redis Pub/Sub**, not XREAD polling!

---

## 5. State Reduction (Client & Server)

### 5.1 Client-Side Reducer (Motia Pattern)

The UI receives all events and computes the current state. Reducers are context-specific:

#### Flow Reducer
```typescript
interface FlowState {
  status: 'running' | 'completed' | 'failed'
  startedAt?: string
  completedAt?: string
  steps: Record<string, StepState>
  logs: LogEntry[]
}

interface StepState {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'retrying' | 'waiting' | 'timeout'
  attempt: number
  startedAt?: string
  completedAt?: string
  error?: string
  awaitType?: 'time' | 'event' | 'trigger'
  awaitData?: any
}

function reduceFlowState(events: EventRecord[]): FlowState {
  const state: FlowState = { status: 'running', steps: {}, logs: [] }
  
  for (const e of events) {
    switch (e.kind) {
      case 'flow.started':
        state.startedAt = e.ts
        break
        
      case 'flow.completed':
        state.status = 'completed'
        state.completedAt = e.ts
        break
        
      case 'flow.failed':
        state.status = 'failed'
        state.completedAt = e.ts
        break
        
      case 'step.started':
        state.steps[e.step!] = {
          status: 'running',
          attempt: e.meta?.attempt || 1,
          startedAt: e.ts,
        }
        break
        
      case 'step.completed':
        state.steps[e.step!].status = 'completed'
        state.steps[e.step!].completedAt = e.ts
        break
        
      case 'step.failed':
        state.steps[e.step!].status = e.data.willRetry ? 'retrying' : 'failed'
        state.steps[e.step!].error = e.data.error
        if (!e.data.willRetry) {
          state.steps[e.step!].completedAt = e.ts
        }
        break
        
      case 'step.retry':
        state.steps[e.step!].status = 'retrying'
        state.steps[e.step!].attempt = e.meta?.attempt || 1
        break
        
      case 'step.await.time':
      case 'step.await.event':
      case 'step.await.trigger':
        state.steps[e.step!].status = 'waiting'
        state.steps[e.step!].awaitType = e.kind.split('.')[2] as 'time' | 'event' | 'trigger'
        state.steps[e.step!].awaitData = e.data
        break
        
      case 'step.resumed':
        state.steps[e.step!].status = 'running'
        delete state.steps[e.step!].awaitType
        delete state.steps[e.step!].awaitData
        break
        
      case 'step.await.timeout':
        state.steps[e.step!].status = 'timeout'
        state.steps[e.step!].error = `Await timeout after ${e.data.duration}ms`
        state.steps[e.step!].completedAt = e.ts
        break
        
      case 'log':
        state.logs.push({ ts: e.ts, step: e.step, level: e.data.level, msg: e.data.msg })
        break
    }
  }
  
  return state
}
```

#### Trigger Reducer
```typescript
interface TriggerState {
  status: 'registered' | 'fired' | 'timeout' | 'cancelled'
  registeredAt?: string
  firedAt?: string
  type?: string
  payload?: any
  correlationId?: string
}

function reduceTriggerState(events: EventRecord[]): TriggerState {
  const state: TriggerState = { status: 'registered' }
  
  for (const e of events) {
    switch (e.kind) {
      case 'trigger.registered':
        state.status = 'registered'
        state.registeredAt = e.ts
        state.type = e.data.type
        state.correlationId = e.correlationId
        break
        
      case 'trigger.fired':
        state.status = 'fired'
        state.firedAt = e.ts
        state.payload = e.data.payload
        break
        
      case 'trigger.timeout':
        state.status = 'timeout'
        break
        
      case 'trigger.cancelled':
        state.status = 'cancelled'
        break
    }
  }
  
  return state
}
```

### 5.2 Server-Side Caching (Optional)

For API endpoints that need current state without sending all events:

```typescript
// In-memory cache per instance (LRU, max 1000 contexts)
const snapshotCache = new LRU<string, any>({ max: 1000, ttl: 60_000 })

async function getContextState(type: string, id: string, reducer: (events) => any): Promise<any> {
  const key = `${type}:${id}`
  let state = snapshotCache.get(key)
  if (state) return state
  
  // Reduce from stream
  const events = await adapter.read(`nq:${type}:${id}`, { limit: 1000, direction: 'forward' })
  state = reducer(events)
  snapshotCache.set(key, state)
  
  return state
}

// Usage
const flowState = await getContextState('flow', flowId, reduceFlowState)
const triggerState = await getContextState('trigger', triggerId, reduceTriggerState)
```

---

## 6. Retry and Await Patterns

### 6.1 Retry Semantics

Steps can fail and automatically retry based on configured retry policies:

#### Retry Configuration
```typescript
// In worker config
export const config = {
  retryPolicy: {
    attempts: 3,                              // Max retry attempts
    backoff: {
      type: 'exponential',                    // 'fixed' | 'exponential'
      delayMs: 1000,                          // Base delay
      maxDelayMs: 60000,                      // Cap for exponential
    },
    retriableErrors: ['NetworkError', 'TimeoutError'], // Optional: only retry specific errors
  }
}
```

#### Retry Event Flow
```
1. step.started (attempt: 1)
2. step.failed (willRetry: true, nextRetryAt: "...")
3. step.retry (delayMs: 1000, attempt: 2)
4. step.started (attempt: 2)
5. step.completed OR step.failed (willRetry: false if max attempts reached)
```

#### Error Classification
```typescript
// In step handler
throw new Error('Network timeout', { 
  code: 'NETWORK_TIMEOUT',
  retriable: true,              // Hint to retry policy
  retryAfter: 5000,            // Override default backoff
})

// Or mark as permanent failure
throw new Error('Invalid input', { 
  retriable: false,            // Skip retries, fail immediately
})
```

### 6.2 Await Patterns

Steps can pause execution and wait for external conditions using `ctx.await()`:

#### Time-based Await
Wait for a specific duration or until a timestamp:

```typescript
// In step handler
export default async function myStep(input, ctx) {
  ctx.logger.info('Starting work...')
  
  // Wait for 5 seconds
  await ctx.await.time(5000)
  
  // Or wait until specific time
  await ctx.await.time(new Date('2025-10-30T12:00:00Z'))
  
  ctx.logger.info('Resumed after wait')
  return { done: true }
}

// Emits:
// 1. step.started
// 2. step.await.time { resumeAt: "2025-10-29T12:00:05Z" }
// 3. (5 seconds pass)
// 4. step.resumed { reason: "Time reached", awaitDuration: 5000 }
// 5. step.completed
```

#### Event-based Await
Wait for a specific event to be emitted:

```typescript
export default async function approvalStep(input, ctx) {
  // Wait for approval event
  const approvalEvent = await ctx.await.event({
    kind: 'approval.granted',              // Event kind to wait for
    where: (e) => e.data.orderId === input.orderId,  // Optional filter
    timeout: 24 * 60 * 60 * 1000,         // 24 hour timeout
  })
  
  return { approved: approvalEvent.data.approved }
}

// Emits:
// 1. step.started
// 2. step.await.event { eventKind: "approval.granted", timeout: 86400000 }
// 3. (wait for event)
// 4. step.resumed { reason: "Event received", awaitDuration: 42000 }
// 5. step.completed
```

#### Trigger-based Await (Webhook, User Action)
Wait for external trigger (webhook, button click, API call):

```typescript
export default async function webhookStep(input, ctx) {
  // Generate trigger ID and URL
  const trigger = await ctx.await.trigger({
    type: 'webhook',                       // 'webhook' | 'user' | 'api'
    payload: { orderId: input.orderId },   // Data to include in trigger
    timeout: 7 * 24 * 60 * 60 * 1000,     // 7 day timeout
  })
  
  // trigger.id can be used to construct webhook URL:
  // POST /api/_flows/triggers/{trigger.id}
  
  // Execution pauses here until webhook is called
  const webhookData = await trigger.wait()
  
  return { webhookData }
}

// Emits:
// 1. step.started
// 2. step.await.trigger { triggerId: "abc-123", triggerType: "webhook", timeout: 604800000 }
// 3. (wait for POST /api/_flows/triggers/abc-123)
// 4. step.resumed { reason: "Webhook received", awaitDuration: 120000 }
// 5. step.completed
```

#### Await Timeout Handling
```typescript
export default async function stepWithTimeout(input, ctx) {
  try {
    const result = await ctx.await.event({
      kind: 'data.ready',
      timeout: 30000,  // 30 second timeout
    })
    return result
  } catch (error) {
    if (error.code === 'AWAIT_TIMEOUT') {
      // Handle timeout
      ctx.logger.warn('Timed out waiting for event')
      return { timedOut: true }
    }
    throw error
  }
}

// On timeout:
// 1. step.await.timeout { awaitType: "event", duration: 30000 }
// 2. step.failed or step.completed (depending on error handling)
```

### 6.3 Await Implementation Details

#### Storage Pattern
When a step calls `ctx.await.*()`:

1. **Save continuation state**: Serialize step context and position to Redis/DB
   ```
   SET nq:await:<triggerId> {
     flowId, stepKey, attempt, 
     awaitType, condition, timeout,
     state: { ... }, timestamp
   }
   ```

2. **Emit await event**: Append to timeline
   ```typescript
   { kind: "step.await.trigger", flow, step, data: { triggerId, ... } }
   ```

3. **Pause job execution**: Job completes/suspends (provider-specific)

4. **On trigger**: Resume from saved state
   ```
   GET nq:await:<triggerId>
   // Re-enqueue step with continuation context
   ```

#### Trigger API Endpoint
```typescript
// POST /api/_flows/triggers/:triggerId
export default defineEventHandler(async (event) => {
  const triggerId = getRouterParam(event, 'triggerId')
  const payload = await readBody(event)
  
  // 1. Load await state
  const awaitState = await redis.get(`nq:await:${triggerId}`)
  if (!awaitState) return { error: 'Trigger not found or expired' }
  
  // 2. Emit resume event
  await streamStore.append(`nq:flow:${awaitState.flowId}`, {
    kind: 'step.resumed',
    flow: awaitState.flowId,
    step: awaitState.stepKey,
    data: { reason: 'Webhook received', awaitDuration: Date.now() - awaitState.timestamp },
    meta: { awaitType: 'trigger', triggerId }
  })
  
  // 3. Re-enqueue step with continuation
  await queue.enqueue({
    name: awaitState.stepKey,
    data: { ...awaitState.state, _resume: true, _triggerPayload: payload },
    opts: { jobId: `${awaitState.flowId}:${awaitState.stepKey}` }
  })
  
  // 4. Clean up
  await redis.del(`nq:await:${triggerId}`)
  
  return { success: true }
})
```

#### Time-based Await (Delayed Job)
```typescript
// ctx.await.time(5000) implementation
async time(delayMs: number | Date) {
  const resumeAt = delayMs instanceof Date ? delayMs : new Date(Date.now() + delayMs)
  
  // Emit await event
  await this.emit({
    kind: 'step.await.time',
    flow: this.flowId,
    step: this.stepKey,
    data: { resumeAt: resumeAt.toISOString(), reason: 'Time-based delay' }
  })
  
  // Schedule resume job
  await queue.enqueue({
    name: this.stepKey,
    data: { ...this.state, _resume: true },
    opts: { 
      jobId: `${this.flowId}:${this.stepKey}`,
      delay: resumeAt.getTime() - Date.now()
    }
  })
  
  // Suspend current execution
  throw new AwaitSuspendError('Time-based await')
}
```

#### Event-based Await (Subscription)
```typescript
// ctx.await.event({ kind: 'approval.granted' }) implementation
async event(opts: { kind: string; where?: (e) => boolean; timeout?: number }) {
  const awaitId = generateId()
  
  // Store await state
  await redis.setex(`nq:await:${awaitId}`, opts.timeout ? opts.timeout / 1000 : 86400, JSON.stringify({
    flowId: this.flowId,
    stepKey: this.stepKey,
    awaitType: 'event',
    condition: { kind: opts.kind, where: opts.where?.toString() },
    timestamp: Date.now()
  }))
  
  // Emit await event
  await this.emit({
    kind: 'step.await.event',
    flow: this.flowId,
    step: this.stepKey,
    data: { eventKind: opts.kind, condition: opts.where?.toString(), timeout: opts.timeout }
  })
  
  // Subscribe to event stream
  // When matching event arrives, resume step
  
  // Suspend current execution
  throw new AwaitSuspendError('Event-based await')
}
```

### 6.4 Combining Retry and Await

Steps can use both retry and await patterns:

```typescript
export default async function resilientStep(input, ctx) {
  try {
    // This might fail and retry
    const data = await fetchData()
    
    // Wait for approval
    const approval = await ctx.await.trigger({
      type: 'webhook',
      timeout: 24 * 60 * 60 * 1000
    })
    
    return { data, approval }
  } catch (error) {
    // Retry policy applies to both fetch and await failures
    throw error
  }
}

// Possible event sequences:
// Success: started → completed
// Retry: started → failed → retry → started → completed
// Await: started → await.trigger → resumed → completed
// Retry + Await: started → failed → retry → started → await.trigger → resumed → completed
```

---

## 6.5 Config-Based Await (Motia Pattern)

For **diagram generation** and **step reusability**, await can be declared in the step config instead of imperatively in code.

### Separated Step Configs

Each step is independent with its own config (Motia-style):

```typescript
// server/queues/create-order.ts
export const config = {
  step: 'create-order',
  queue: 'orders',
  retryPolicy: { attempts: 3, backoff: { type: 'exponential', delayMs: 1000 } },
  // This step emits events that other steps can subscribe to
  emits: ['order.created']
}

export default async function createOrder(input, ctx) {
  const order = await db.createOrder(input)
  
  // Emit event for other steps to react
  ctx.emit({ kind: 'order.created', data: { orderId: order.id, total: order.total } })
  
  return { orderId: order.id }
}
```

```typescript
// server/queues/wait-for-payment.ts
export const config = {
  step: 'wait-for-payment',
  queue: 'payments',
  
  // Subscribe to events - this step can be part of ANY flow
  subscriptions: [
    {
      eventKind: 'order.created',
      when: (event, ctx) => event.data.requiresPayment === true,
      map: (event) => ({
        orderId: event.data.orderId,
        amount: event.data.total
      })
    }
  ],
  
  // Declarative await - parseable for diagrams!
  await: {
    type: 'event',
    eventKind: 'payment.confirmed',
    where: (event, ctx) => event.data.orderId === ctx.input.orderId,
    timeout: 24 * 60 * 60 * 1000, // 24 hours
    onTimeout: 'cancel-order' // Optional: step to run on timeout
  },
  
  emits: ['order.paid', 'payment.timeout']
}

export default async function waitForPayment(input, ctx) {
  // Engine automatically handles await based on config
  // This handler runs AFTER payment.confirmed event arrives
  
  ctx.logger.info(`Payment confirmed for order ${input.orderId}`)
  
  // Emit success event
  ctx.emit({ kind: 'order.paid', data: { orderId: input.orderId } })
  
  return { paid: true, orderId: input.orderId }
}
```

```typescript
// server/queues/fulfill-order.ts
export const config = {
  step: 'fulfill-order',
  queue: 'fulfillment',
  
  subscriptions: [
    {
      eventKind: 'order.paid',
      map: (event) => ({ orderId: event.data.orderId })
    }
  ],
  
  emits: ['order.fulfilled']
}

export default async function fulfillOrder(input, ctx) {
  await shipOrder(input.orderId)
  
  ctx.emit({ kind: 'order.fulfilled', data: { orderId: input.orderId } })
  
  return { fulfilled: true }
}
```

### Flow Engine Processing

The flow engine detects `config.await` and handles pause/resume automatically:

```typescript
async function executeStep(stepConfig, input, ctx) {
  // Check if step is resuming from await
  if (input._resume) {
    // Skip to handler execution
    return await stepConfig.handler(input, ctx)
  }
  
  // Check for await config BEFORE running handler
  if (stepConfig.await?.type === 'event' || stepConfig.await?.type === 'trigger') {
    // Emit await event immediately
    await ctx.emit({
      kind: `step.await.${stepConfig.await.type}`,
      subject: ctx.flowId,
      flow: ctx.flowId,
      step: ctx.stepKey,
      data: {
        eventKind: stepConfig.await.eventKind,
        triggerType: stepConfig.await.triggerType,
        timeout: stepConfig.await.timeout
      }
    })
    
    // Register subscription/trigger
    await registerAwait(stepConfig.await, ctx)
    
    // Suspend step (job completes, will be re-enqueued on resume)
    return { _suspended: true }
  }
  
  // Run handler normally
  const result = await stepConfig.handler(input, ctx)
  
  // Check for time-based await AFTER handler
  if (stepConfig.await?.type === 'time') {
    const delay = typeof stepConfig.await.delay === 'function' 
      ? stepConfig.await.delay(result) 
      : stepConfig.await.delay
      
    await ctx.emit({
      kind: 'step.await.time',
      subject: ctx.flowId,
      flow: ctx.flowId,
      step: ctx.stepKey,
      data: { delay, resumeAt: new Date(Date.now() + delay).toISOString() }
    })
    
    // Schedule delayed re-enqueue
    await scheduleResume(ctx, delay)
    
    return { _suspended: true }
  }
  
  return result
}
```

### Step Reusability

Steps are independent and can be reused across multiple flows:

```typescript
// Flow 1: Simple Order
'create-order' → emits 'order.created'
  ↓
'wait-for-payment' → subscribes to 'order.created', awaits 'payment.confirmed'
  ↓
'fulfill-order' → subscribes to 'order.paid'

// Flow 2: Subscription Signup (REUSES wait-for-payment!)
'create-subscription' → emits 'order.created'
  ↓
'wait-for-payment' → subscribes to 'order.created' (SAME STEP!)
  ↓
'activate-subscription' → subscribes to 'order.paid'

// Flow 3: Refund Process (REUSES wait-for-payment with different event!)
'initiate-refund' → emits 'refund.initiated'
  ↓
'wait-for-approval' → subscribes to 'refund.initiated', awaits 'approval.granted'
  ↓
'process-refund' → subscribes to 'approval.granted'
```

### Diagram Generation

Registry scans step configs at build time to generate flow diagrams:

```typescript
interface FlowDiagram {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

interface FlowNode {
  id: string
  type: 'step' | 'await-step'
  await?: {
    type: 'time' | 'event' | 'trigger'
    eventKind?: string
    timeout?: number
  }
  emits?: string[]
  subscriptions?: Array<{ eventKind: string; when?: string }>
}

interface FlowEdge {
  from: string
  to: string
  label: string // Event kind
  type?: 'emit' | 'await'
  condition?: string
  timeout?: number
}

function buildFlowDiagram(flowName: string): FlowDiagram {
  const steps = registry.getFlowSteps(flowName)
  
  const nodes: FlowNode[] = steps.map(step => ({
    id: step.name,
    type: step.config.await ? 'await-step' : 'step',
    await: step.config.await,
    emits: step.config.emits || [],
    subscriptions: step.config.subscriptions || []
  }))
  
  const edges: FlowEdge[] = []
  
  // Build edges from emits → subscriptions
  for (const step of steps) {
    for (const emitKind of step.config.emits || []) {
      // Find steps that subscribe to this event
      const subscribers = steps.filter(s =>
        s.config.subscriptions?.some(sub => sub.eventKind === emitKind)
      )
      
      for (const subscriber of subscribers) {
        const subscription = subscriber.config.subscriptions!.find(
          sub => sub.eventKind === emitKind
        )
        
        edges.push({
          from: step.name,
          to: subscriber.name,
          label: emitKind,
          type: 'emit',
          condition: subscription?.when?.toString()
        })
      }
    }
    
    // Add await self-loop edges
    if (step.config.await) {
      edges.push({
        from: step.name,
        to: step.name,
        label: `⏱ ${step.config.await.eventKind || step.config.await.type}`,
        type: 'await',
        timeout: step.config.await.timeout
      })
    }
  }
  
  return { nodes, edges }
}
```

### Visual Diagram Example

```
┌──────────────┐
│ create-order │
└──────┬───────┘
       │ order.created
       ▼
┌─────────────────────┐
│ wait-for-payment    │
│ ⏱ await: event      │ ◄─┐
│   payment.confirmed │   │ (waits here)
│   timeout: 24h      │   │
└──────┬──────────────┘   │
       │ order.paid       │
       ▼                  │
┌──────────────┐         │
│ fulfill-order│         │
└──────────────┘         │
                         │
                  (External Payment
                   System emits event)
```

### Config Schema

```typescript
interface StepConfig {
  step: string
  queue: string
  
  // Retry configuration
  retryPolicy?: {
    attempts: number
    backoff?: { type: 'fixed' | 'exponential'; delayMs: number; maxDelayMs?: number }
  }
  
  // Event subscriptions (what triggers this step)
  subscriptions?: Array<{
    eventKind: string
    when?: (event: EventRecord, ctx: Context) => boolean
    map?: (event: EventRecord) => any
  }>
  
  // Declarative await (for diagram generation)
  await?: {
    type: 'time' | 'event' | 'trigger'
    // For time-based
    delay?: number | string | ((result: any) => number)
    // For event-based
    eventKind?: string
    where?: (event: EventRecord, ctx: Context) => boolean
    // For trigger-based
    triggerType?: 'webhook' | 'user' | 'api'
    // Common
    timeout?: number
    onTimeout?: string // Step name to run on timeout
  }
  
  // What events this step emits
  emits?: string[]
  
  // Handler
  handler?: string | ((input: any, ctx: Context) => any)
}
```

### Benefits

✅ **Steps are truly independent** - No hardcoded flow logic
✅ **Diagram generation works** - Parse config for visualization
✅ **Await is declarative** - Engine handles pause/resume automatically
✅ **Hot reload friendly** - Registry rebuild updates graph
✅ **Testable in isolation** - Mock events to test individual steps
✅ **Reusable across flows** - Same step, different context

---

## 7. Implementation Changes

### 7.1 Remove

- ❌ `nq:proj:flow:<flowName>:<flowId>` (snapshot patches)
- ❌ `nq:proj:flow-steps:<flowId>` (per-step patches)
- ❌ `nq:proj:flow-step-index:<flowId>` (log index)
- ❌ All projection wiring in `flowProjections.ts`
- ❌ XREAD polling loops

### 7.2 Keep

- ✅ `nq:flow:<flowId>` (single timeline stream)
- ✅ Redis Sorted Set `nq:flows:<flowName>` (index)

### 7.3 Add

- ✅ Redis Pub/Sub integration in `redisStreamsAdapter.append()`
- ✅ Pub/Sub subscription in `redisStreamsAdapter.subscribe()`
- ✅ Reducer functions in composables
- ✅ SSE backfill + live subscription

### 7.4 New `redisStreamsAdapter` (Outline)

```typescript
export function createRedisStreamsAdapter() {
  const redis = new IORedis({ /* config */ })
  const pubsub = new IORedis({ /* separate connection for pub/sub */ })
  
  return {
    async append(stream, event) {
      // 1. Add to stream
      const id = await redis.xadd(stream, '*', /* fields */)
      
      // 2. Publish to channel for real-time
      const channel = `${stream}:live`
      await redis.publish(channel, JSON.stringify({ ...event, id, ts }))
      
      // 3. Update index if flow.started
      if (event.kind === 'flow.started') {
        const flowName = event.data.name
        await redis.zadd(`nq:flows:${flowName}`, Date.now(), event.flow)
      }
      
      return { ...event, id, ts, stream }
    },
    
    async read(stream, opts) {
      // XRANGE or XREVRANGE for historical data
      const results = await redis.xrange(/* ... */)
      return parseResults(results)
    },
    
    async subscribe(stream, handler) {
      const channel = `${stream}:live`
      
      // Subscribe to Pub/Sub channel
      await pubsub.subscribe(channel)
      
      // Handle incoming messages
      const listener = (ch, message) => {
        if (ch === channel) {
          handler(JSON.parse(message))
        }
      }
      pubsub.on('message', listener)
      
      return {
        unsubscribe() {
          pubsub.unsubscribe(channel)
          pubsub.off('message', listener)
        }
      }
    }
  }
}
```

---

## 8. API Endpoints (Generic Pattern)

### 8.1 List Items by Type

```typescript
GET /api/_events/:type/list?limit=50&name=<name>

// Examples:
// GET /api/_events/flow/list?name=example-flow
// GET /api/_events/trigger/list

// Implementation:
const indexKey = name ? `nq:${type}s:${name}` : `nq:${type}s`
const items = await redis.zrevrange(indexKey, 0, limit - 1)
return items.map(id => ({ id, /* fetch minimal metadata */ }))
```

### 8.2 Get Context State (Snapshot)

```typescript
GET /api/_events/:type/:id

// Examples:
// GET /api/_events/flow/abc-123-def
// GET /api/_events/trigger/approval-123

// Implementation:
const reducer = getReducerForType(type) // flow → reduceFlowState, trigger → reduceTriggerState
const state = await getContextState(type, id, reducer)
return state
```

### 8.3 Stream Events (SSE)

```typescript
GET /api/_events/:type/:id/stream

// Examples:
// GET /api/_events/flow/abc-123-def/stream
// GET /api/_events/trigger/approval-123/stream

// Implementation:
const stream = createEventStream(event)
const streamName = `nq:${type}:${id}`

// 1. Backfill
const events = await adapter.read(streamName, { limit: 100, direction: 'forward' })
for (const e of events) {
  stream.push(JSON.stringify(e))
}

// 2. Subscribe to live
const unsub = await adapter.subscribe(streamName, (e) => {
  stream.push(JSON.stringify(e))
})

stream.onClosed(() => unsub())
return stream.send()
```

### 8.4 Trigger Endpoint (for Await)

```typescript
POST /api/_triggers/:triggerId

// Resume a step or flow waiting for webhook/trigger
// See section 6.3 for implementation details
```

---

## 9. Benefits

### ✅ Storage Efficiency
- **1 stream per context** (was 4-5 streams in v0.2)
- **No duplication**: Events stored once, referenced by position
- **Index is tiny**: Sorted set ~100 bytes per entry
- **Works for any context**: flows, triggers, webhooks, etc.

### ✅ Real-time Performance
- **Pub/Sub fanout**: Instant delivery to all instances
- **No polling**: Zero CPU for idle connections
- **Backpressure**: Pub/Sub handles it naturally

### ✅ Horizontal Scaling
- **Stateless instances**: Any instance can serve any context
- **Shared index**: All instances see same items via Redis
- **No coordination**: Pub/Sub handles distribution

### ✅ Simplified Code
- **No projection wiring**: Just append to stream
- **No complex reducers on server**: Client handles it
- **Single subscription model**: Pub/Sub for everything
- **Generic pattern**: Same code for flows, triggers, and future contexts

### ✅ Extensible Architecture
- **Add new contexts easily**: Just define reducer and event kinds
- **Trigger system**: Ready for webhooks, scheduled events, etc.
- **Future-proof**: Can add any event source without architectural changes

### ✅ Motia-like UX
- **Event sourcing**: Full history always available
- **Real-time updates**: Sub-second latency
- **Time travel**: Replay events to any point
- **Debuggable**: See exact event sequence

---

## 10. Migration from v0.2

1. **Update event schema**: Add `subject` field, make `flow` optional
2. **Update internal bus**: Change `subscribeStream` → `subscribeSubject`
3. **Stop writing projections**: Comment out projection wiring
4. **Deploy new adapter**: With Pub/Sub support
5. **Update SSE endpoints**: Use generic `/api/_events/:type/:id/stream`
6. **Add reducers**: Client-side state computation (flow, trigger, etc.)
7. **Clean up old streams**: Delete `nq:proj:*` streams (optional)

---

## 11. Performance Targets

- **Write latency**: < 5ms (XADD + PUBLISH)
- **Read latency**: < 10ms (XRANGE with limit 100)
- **Subscription setup**: < 50ms (SUBSCRIBE + backfill)
- **Real-time delivery**: < 100ms (Pub/Sub propagation)
- **Memory per instance**: < 100MB (LRU cache for 1000 contexts)
- **Storage per context**: ~100 bytes per event, ~10KB per run (100 events)

---

## 12. Example: Minimal Working Implementation

See next section for code examples of:
- Simplified event emitter
- Redis adapter with Pub/Sub
- SSE endpoint with backfill
- Client reducer composable
