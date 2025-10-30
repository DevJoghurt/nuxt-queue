# Implementation Guide: Lean Event Architecture

This document provides concrete code examples for migrating to the v0.3 lean architecture.

---

## 1. Updated Event Schema

### `src/runtime/server/events/types.ts`

```typescript
/**
 * Lean event envelope (v0.3)
 * - Removed: stream, subject, v
 * - Renamed: flowId → flow, stepKey → step
 * - Simplified: meta is optional and only for additional context
 */
export interface EventRecord {
  id: string           // Redis Stream ID
  ts: string           // ISO 8601 timestamp
  kind: string         // Event type (e.g., "flow.started", "step.completed", "log")
  flow: string         // Flow run ID
  step?: string        // Step name (for step-scoped events)
  data: any            // Event-specific payload
  meta?: {             // Optional metadata
    attempt?: number   // Retry attempt number
    jobId?: string     // Queue job ID
    [key: string]: any // Extensible
  }
}

export type EventKind =
  | 'flow.started'
  | 'flow.completed'
  | 'flow.failed'
  | 'step.started'
  | 'step.completed'
  | 'step.failed'
  | 'step.retry'
  | 'step.await.time'
  | 'step.await.event'
  | 'step.await.trigger'
  | 'step.resumed'
  | 'step.await.timeout'
  | 'log'
  | 'state.set'
```

---

## 2. Simplified Event Manager

### `src/runtime/server/utils/useEventManager.ts`

```typescript
import { getEventBus } from '../events/eventBus'
import type { EventRecord } from '../events/types'

export interface EventManager {
  /**
   * Publish an ingress event to the internal bus.
   * Wiring will persist it to the stream.
   */
  publish(event: Omit<EventRecord, 'id' | 'ts'>, ctx?: { flowId?: string, stepKey?: string }): Promise<void>
  
  /**
   * Subscribe to events by kind (includes both ingress and canonical)
   */
  onKind(kind: string, handler: (e: EventRecord) => void): () => void
}

let cached: EventManager | null = null

export function useEventManager(): EventManager {
  if (cached) return cached
  
  const bus = getEventBus()
  
  const publish: EventManager['publish'] = async (event, ctx) => {
    // Normalize to new schema
    const normalized: any = {
      kind: event.kind,
      flow: ctx?.flowId || event.flow,
      step: ctx?.stepKey || event.step,
      data: event.data || {},
      meta: event.meta || {},
    }
    
    // Publish to internal bus (wiring will persist)
    bus.publish(normalized)
  }
  
  const onKind: EventManager['onKind'] = (kind, handler) => {
    return bus.onKind(kind, handler)
  }
  
  cached = { publish, onKind }
  return cached
}
```

---

## 3. Redis Adapter with Pub/Sub

### `src/runtime/server/streamStore/adapters/redisStreamsAdapter.ts`

```typescript
import IORedis from 'ioredis'
import type { StreamAdapter, EventRecord } from '../types'
import { useRuntimeConfig } from '#imports'

export function createRedisStreamsAdapter(): StreamAdapter {
  const rc: any = useRuntimeConfig()
  const conn = rc?.queue?.redis || {}
  
  // Main connection for XADD/XRANGE
  const redis = new IORedis({
    host: conn.host || '127.0.0.1',
    port: conn.port || 6379,
    username: conn.username,
    password: conn.password,
  })
  
  // Separate connection for Pub/Sub (required by ioredis)
  const pubsub = new IORedis({
    host: conn.host || '127.0.0.1',
    port: conn.port || 6379,
    username: conn.username,
    password: conn.password,
  })

  return {
    async append(stream: string, event: Omit<EventRecord, 'id' | 'ts'>): Promise<EventRecord> {
      const ts = new Date().toISOString()
      
      // Serialize data and meta as JSON
      const fields = [
        'kind', event.kind,
        'flow', event.flow,
        'step', event.step || '',
        'data', JSON.stringify(event.data || {}),
        'meta', JSON.stringify(event.meta || {}),
        'ts', ts,
      ]
      
      // 1. Write to stream
      const id = await redis.xadd(stream, '*', ...fields)
      
      // 2. Build canonical record
      const record: EventRecord = {
        id,
        ts,
        kind: event.kind,
        flow: event.flow,
        step: event.step,
        data: event.data,
        meta: event.meta,
      }
      
      // 3. Publish to Pub/Sub for real-time distribution
      const channel = `${stream}:live`
      await redis.publish(channel, JSON.stringify(record))
      
      // 4. Update flow index if this is flow.started
      if (event.kind === 'flow.started' && event.data?.name) {
        const flowName = event.data.name
        const score = Date.now()
        await redis.zadd(`nq:flows:${flowName}`, score, event.flow)
      }
      
      if (process.env.NQ_DEBUG_EVENTS === '1') {
        console.log('[redis-streams] append + publish', { stream, id, channel })
      }
      
      return record
    },

    async read(stream: string, opts?: { limit?: number, fromId?: string, direction?: 'forward' | 'backward' }): Promise<EventRecord[]> {
      const limit = opts?.limit || 100
      const fromId = opts?.fromId || (opts?.direction === 'backward' ? '+' : '-')
      const toId = opts?.direction === 'backward' ? '-' : '+'
      
      let results: any[]
      if (opts?.direction === 'backward') {
        results = await redis.xrevrange(stream, fromId, toId, 'COUNT', limit)
      } else {
        results = await redis.xrange(stream, fromId, toId, 'COUNT', limit)
      }
      
      return results.map(([id, fields]) => parseFields(id, fields))
    },

    async subscribe(stream: string, handler: (e: EventRecord) => void): Promise<{ unsubscribe(): void }> {
      const channel = `${stream}:live`
      
      // Subscribe to Pub/Sub channel
      await pubsub.subscribe(channel)
      
      if (process.env.NQ_DEBUG_EVENTS === '1') {
        console.log('[redis-streams] subscribed to pub/sub', { channel })
      }
      
      // Handle incoming messages
      const listener = (ch: string, message: string) => {
        if (ch === channel) {
          try {
            const event = JSON.parse(message)
            handler(event)
          } catch (err) {
            console.error('[redis-streams] parse error', err)
          }
        }
      }
      
      pubsub.on('message', listener)
      
      return {
        unsubscribe() {
          pubsub.unsubscribe(channel)
          pubsub.off('message', listener)
        }
      }
    },

    async close(): Promise<void> {
      await redis.quit()
      await pubsub.quit()
    }
  }
}

function parseFields(id: string, fields: string[]): EventRecord {
  const obj: Record<string, string> = {}
  for (let i = 0; i < fields.length; i += 2) {
    obj[fields[i]] = fields[i + 1]
  }
  
  return {
    id,
    ts: obj.ts,
    kind: obj.kind,
    flow: obj.flow,
    step: obj.step || undefined,
    data: obj.data ? JSON.parse(obj.data) : {},
    meta: obj.meta ? JSON.parse(obj.meta) : undefined,
  }
}
```

---

## 4. Simplified Wiring (Single Handler)

### `src/runtime/server/streamStore/wiring/flowWiring.ts`

```typescript
import type { StreamAdapter } from '../types'
import type { EventRecord } from '../../events/types'
import { getEventBus } from '../../events/eventBus'

export interface FlowWiringDeps {
  adapter: StreamAdapter
}

export function createFlowWiring(deps: FlowWiringDeps) {
  const { adapter } = deps
  const bus = getEventBus()
  const unsubs: Array<() => void> = []
  let wired = false

  function start() {
    if (wired) return
    wired = true

    // Listen to ALL flow-related events and persist to single stream
    const flowKinds = [
      'flow.started',
      'flow.completed',
      'flow.failed',
      'step.started',
      'step.completed',
      'step.failed',
      'log',
    ]

    for (const kind of flowKinds) {
      unsubs.push(bus.onKind(kind, async (e: EventRecord) => {
        try {
          // Only persist ingress events (without id)
          if ((e as any).id) return

          // Ensure we have a flowId
          const flowId = e.flow
          if (!flowId) return

          // Persist to single stream
          const stream = `nq:flow:${flowId}`
          await adapter.append(stream, e)
        } catch (err) {
          if (process.env.NQ_DEBUG_EVENTS === '1') {
            console.error('[flow-wiring] persist error', err)
          }
        }
      }))
    }

    if (process.env.NQ_DEBUG_EVENTS === '1') {
      console.log('[flow-wiring] started, listening to', flowKinds.length, 'kinds')
    }
  }

  function stop() {
    for (const u of unsubs.splice(0)) {
      try {
        u()
      } catch {}
    }
    wired = false
  }

  return { start, stop }
}
```

---

## 5. Client-Side Reducer

### `src/runtime/app/composables/useFlowState.ts`

```typescript
import type { EventRecord } from '~/types'

export interface FlowState {
  status: 'running' | 'completed' | 'failed'
  name?: string
  queue?: string
  startedAt?: string
  completedAt?: string
  duration?: number
  steps: Record<string, StepState>
  logs: LogEntry[]
}

export interface StepState {
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  attempt: number
  startedAt?: string
  completedAt?: string
  duration?: number
  error?: string
}

export interface LogEntry {
  ts: string
  step?: string
  level: string
  msg: string
}

export function useFlowState() {
  /**
   * Reduce a stream of events to current flow state
   */
  function reduce(events: EventRecord[]): FlowState {
    const state: FlowState = {
      status: 'running',
      steps: {},
      logs: [],
    }

    for (const e of events) {
      switch (e.kind) {
        case 'flow.started':
          state.name = e.data.name
          state.queue = e.data.queue
          state.startedAt = e.ts
          break

        case 'flow.completed':
          state.status = 'completed'
          state.completedAt = e.ts
          state.duration = e.data.duration
          break

        case 'flow.failed':
          state.status = 'failed'
          state.completedAt = e.ts
          state.duration = e.data.duration
          break

        case 'step.started':
          if (!e.step) continue
          state.steps[e.step] = {
            name: e.step,
            status: 'running',
            attempt: e.meta?.attempt || 1,
            startedAt: e.ts,
          }
          break

        case 'step.completed':
          if (!e.step || !state.steps[e.step]) continue
          state.steps[e.step].status = 'completed'
          state.steps[e.step].completedAt = e.ts
          state.steps[e.step].duration = e.data.duration
          break

        case 'step.failed':
          if (!e.step || !state.steps[e.step]) continue
          state.steps[e.step].status = 'failed'
          state.steps[e.step].completedAt = e.ts
          state.steps[e.step].error = e.data.error
          break

        case 'log':
          state.logs.push({
            ts: e.ts,
            step: e.step,
            level: e.data.level,
            msg: e.data.msg,
          })
          break
      }
    }

    return state
  }

  return { reduce }
}
```

---

## 6. SSE Endpoint with Backfill

### `src/runtime/server/api/_flows/[name]/runs/[id]/stream.get.ts`

```typescript
import { defineEventHandler, getRouterParam, createEventStream, setHeader } from '#imports'
import { useStreamStore } from '~/server/utils/useStreamStore'

export default defineEventHandler(async (event) => {
  const flowName = getRouterParam(event, 'name')
  const flowId = getRouterParam(event, 'id')
  
  if (!flowName || !flowId) {
    return { error: 'Missing parameters' }
  }

  const store = useStreamStore()
  const stream = `nq:flow:${flowId}`
  
  const eventStream = createEventStream(event)
  
  // SSE headers
  setHeader(event, 'Content-Type', 'text/event-stream')
  setHeader(event, 'Cache-Control', 'no-cache')
  setHeader(event, 'Connection', 'keep-alive')
  setHeader(event, 'X-Accel-Buffering', 'no')

  try {
    // 1. Backfill recent events (last 100)
    const events = await store.read(stream, {
      limit: 100,
      direction: 'forward',
    })
    
    for (const e of events) {
      await eventStream.push(JSON.stringify(e))
    }

    // 2. Subscribe to live updates
    const unsub = await store.subscribe(stream, (e) => {
      void eventStream.push(JSON.stringify(e))
    })

    // 3. Cleanup on close
    eventStream.onClosed(() => {
      unsub()
      void eventStream.close()
    })

    return eventStream.send()
  } catch (err) {
    console.error('[sse] stream error', err)
    return { error: 'Stream failed' }
  }
})
```

---

## 7. Retry and Await Implementation

### 7.1 Retry Context Method

Add retry support to the run context:

```typescript
// src/runtime/server/worker/context.ts

interface RetryConfig {
  attempts: number
  backoff?: {
    type: 'fixed' | 'exponential'
    delayMs: number
    maxDelayMs?: number
  }
}

export class WorkerContext {
  private retryConfig?: RetryConfig
  
  async executeWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    const maxAttempts = this.retryConfig?.attempts || 1
    let lastError: Error | null = null
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Emit step.started
        await this.emit({
          kind: 'step.started',
          flow: this.flowId,
          step: this.stepKey,
          data: { input: this.input },
          meta: { attempt, jobId: this.jobId }
        })
        
        // Execute step
        const result = await fn()
        
        // Emit step.completed
        await this.emit({
          kind: 'step.completed',
          flow: this.flowId,
          step: this.stepKey,
          data: { result },
          meta: { attempt, duration: Date.now() - this.startTime }
        })
        
        return result
      } catch (error) {
        lastError = error as Error
        const willRetry = attempt < maxAttempts && this.isRetriable(error)
        
        // Calculate backoff
        let delayMs = 0
        if (willRetry && this.retryConfig?.backoff) {
          const { type, delayMs: baseDelay, maxDelayMs } = this.retryConfig.backoff
          delayMs = type === 'exponential' 
            ? Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelayMs || Infinity)
            : baseDelay
        }
        
        const nextRetryAt = willRetry ? new Date(Date.now() + delayMs).toISOString() : undefined
        
        // Emit step.failed
        await this.emit({
          kind: 'step.failed',
          flow: this.flowId,
          step: this.stepKey,
          data: { 
            error: error.message, 
            willRetry,
            nextRetryAt
          },
          meta: { 
            attempt, 
            maxAttempts,
            backoff: this.retryConfig?.backoff
          }
        })
        
        if (willRetry) {
          // Emit step.retry
          await this.emit({
            kind: 'step.retry',
            flow: this.flowId,
            step: this.stepKey,
            data: { reason: error.message, delayMs },
            meta: { attempt: attempt + 1, scheduledAt: nextRetryAt }
          })
          
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, delayMs))
        } else {
          // Max attempts reached or non-retriable error
          throw error
        }
      }
    }
    
    throw lastError!
  }
  
  private isRetriable(error: any): boolean {
    // Check if error is marked as retriable
    if (error.retriable === false) return false
    if (error.retriable === true) return true
    
    // Check error codes/types
    const retriableCodes = ['NETWORK_ERROR', 'TIMEOUT', 'ECONNREFUSED', 'ETIMEDOUT']
    return retriableCodes.includes(error.code)
  }
}
```

### 7.2 Await Context Methods

Add await support to the run context:

```typescript
// src/runtime/server/worker/context.ts

class AwaitSuspendError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AwaitSuspendError'
  }
}

export interface AwaitMethods {
  time(delayMs: number | Date): Promise<void>
  event(opts: { kind: string; where?: (e: EventRecord) => boolean; timeout?: number }): Promise<EventRecord>
  trigger(opts: { type: 'webhook' | 'user' | 'api'; payload?: any; timeout?: number }): Promise<{ id: string; wait: () => Promise<any> }>
}

export class WorkerContext {
  public await: AwaitMethods
  
  constructor(/* ... */) {
    // ... existing setup ...
    
    this.await = {
      time: this.awaitTime.bind(this),
      event: this.awaitEvent.bind(this),
      trigger: this.awaitTrigger.bind(this)
    }
  }
  
  private async awaitTime(delayMs: number | Date): Promise<void> {
    const resumeAt = delayMs instanceof Date ? delayMs : new Date(Date.now() + delayMs)
    const delay = resumeAt.getTime() - Date.now()
    
    // Emit await event
    await this.emit({
      kind: 'step.await.time',
      flow: this.flowId,
      step: this.stepKey,
      data: { resumeAt: resumeAt.toISOString(), reason: 'Time-based delay' }
    })
    
    // Save continuation state
    await this.saveContinuation({ awaitType: 'time', resumeAt })
    
    // Schedule resume job
    await this.queue.enqueue({
      name: this.stepKey,
      data: { ...this.state, _resume: true },
      opts: { 
        jobId: `${this.flowId}:${this.stepKey}`,
        delay: Math.max(0, delay)
      }
    })
    
    // Suspend execution
    throw new AwaitSuspendError('Time-based await')
  }
  
  private async awaitEvent(opts: { kind: string; where?: (e: EventRecord) => boolean; timeout?: number }): Promise<EventRecord> {
    const awaitId = `await:${this.flowId}:${this.stepKey}:${Date.now()}`
    
    // Emit await event
    await this.emit({
      kind: 'step.await.event',
      flow: this.flowId,
      step: this.stepKey,
      data: { 
        eventKind: opts.kind, 
        condition: opts.where?.toString(), 
        timeout: opts.timeout 
      }
    })
    
    // Save continuation state with subscription
    await this.saveContinuation({ 
      awaitType: 'event', 
      awaitId,
      eventKind: opts.kind,
      condition: opts.where?.toString(),
      timeout: opts.timeout
    })
    
    // Set up event subscription (handled by flow engine)
    // When matching event arrives, it will re-enqueue this step
    
    // Set timeout if specified
    if (opts.timeout) {
      await this.queue.enqueue({
        name: `_await_timeout:${this.stepKey}`,
        data: { awaitId, flowId: this.flowId, stepKey: this.stepKey },
        opts: { 
          jobId: `timeout:${awaitId}`,
          delay: opts.timeout 
        }
      })
    }
    
    // Suspend execution
    throw new AwaitSuspendError('Event-based await')
  }
  
  private async awaitTrigger(opts: { type: 'webhook' | 'user' | 'api'; payload?: any; timeout?: number }): Promise<{ id: string; wait: () => Promise<any> }> {
    const triggerId = `trigger:${this.flowId}:${this.stepKey}:${Date.now()}`
    
    // Emit await event
    await this.emit({
      kind: 'step.await.trigger',
      flow: this.flowId,
      step: this.stepKey,
      data: { 
        triggerId,
        triggerType: opts.type,
        payload: opts.payload,
        timeout: opts.timeout 
      }
    })
    
    // Save continuation state
    await this.saveContinuation({ 
      awaitType: 'trigger',
      triggerId,
      triggerType: opts.type,
      payload: opts.payload,
      timeout: opts.timeout
    })
    
    // Set timeout if specified
    if (opts.timeout) {
      await this.queue.enqueue({
        name: `_await_timeout:${this.stepKey}`,
        data: { triggerId, flowId: this.flowId, stepKey: this.stepKey },
        opts: { 
          jobId: `timeout:${triggerId}`,
          delay: opts.timeout 
        }
      })
    }
    
    return {
      id: triggerId,
      wait: async () => {
        // This suspend the current execution
        // When trigger API is called, job will be re-enqueued with _triggerPayload
        throw new AwaitSuspendError('Trigger-based await')
      }
    }
  }
  
  private async saveContinuation(awaitData: any): Promise<void> {
    const key = `nq:await:${awaitData.triggerId || awaitData.awaitId || `${this.flowId}:${this.stepKey}`}`
    const ttl = awaitData.timeout ? Math.ceil(awaitData.timeout / 1000) : 86400 // 24h default
    
    await this.redis.setex(key, ttl, JSON.stringify({
      flowId: this.flowId,
      stepKey: this.stepKey,
      attempt: this.attempt,
      state: this.state,
      timestamp: Date.now(),
      ...awaitData
    }))
  }
}
```

### 7.3 Trigger API Endpoint

```typescript
// src/runtime/server/api/_flows/triggers/[id].post.ts

export default defineEventHandler(async (event) => {
  const triggerId = getRouterParam(event, 'id')
  const payload = await readBody(event)
  
  const redis = useRedis()
  const queue = useQueue()
  const streamStore = useStreamStore()
  
  // Load await state
  const key = `nq:await:${triggerId}`
  const awaitStateJson = await redis.get(key)
  
  if (!awaitStateJson) {
    throw createError({
      statusCode: 404,
      message: 'Trigger not found or expired'
    })
  }
  
  const awaitState = JSON.parse(awaitStateJson)
  
  // Emit resume event
  await streamStore.append(`nq:flow:${awaitState.flowId}`, {
    kind: 'step.resumed',
    flow: awaitState.flowId,
    step: awaitState.stepKey,
    data: { 
      reason: 'Trigger received', 
      awaitDuration: Date.now() - awaitState.timestamp 
    },
    meta: { 
      awaitType: awaitState.awaitType,
      triggerId 
    }
  })
  
  // Re-enqueue step with continuation
  await queue.enqueue({
    name: awaitState.stepKey,
    data: { 
      ...awaitState.state, 
      _resume: true, 
      _triggerPayload: payload 
    },
    opts: { 
      jobId: `${awaitState.flowId}:${awaitState.stepKey}` 
    }
  })
  
  // Clean up
  await redis.del(key)
  
  // Cancel timeout job if exists
  const timeoutJobId = `timeout:${triggerId}`
  try {
    await queue.removeJob(timeoutJobId)
  } catch {
    // Timeout job may not exist or already executed
  }
  
  return { 
    success: true,
    flowId: awaitState.flowId,
    step: awaitState.stepKey
  }
})
```

### 7.4 Usage Examples

#### Retry Example
```typescript
// server/queues/fetch-api.ts

export const config = {
  queue: 'api',
  retryPolicy: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delayMs: 1000,
      maxDelayMs: 30000
    }
  }
}

export default async function fetchApi(input: { url: string }, ctx) {
  // This will automatically retry on failure
  const response = await fetch(input.url)
  
  if (!response.ok) {
    // Mark as retriable
    const error = new Error(`HTTP ${response.status}`)
    error.retriable = true
    throw error
  }
  
  return await response.json()
}
```

#### Time-based Await Example
```typescript
// server/queues/delayed-notification.ts

export default async function delayedNotification(input: { userId: string, message: string }, ctx) {
  ctx.logger.info('Starting notification flow')
  
  // Wait for 5 minutes
  await ctx.await.time(5 * 60 * 1000)
  
  ctx.logger.info('Sending delayed notification')
  await sendNotification(input.userId, input.message)
  
  return { sent: true }
}
```

#### Event-based Await Example
```typescript
// server/queues/order-approval.ts

export default async function orderApproval(input: { orderId: string }, ctx) {
  // Create order
  await createOrder(input.orderId)
  
  // Wait for payment confirmation event (max 24 hours)
  const paymentEvent = await ctx.await.event({
    kind: 'payment.confirmed',
    where: (e) => e.data.orderId === input.orderId,
    timeout: 24 * 60 * 60 * 1000
  })
  
  // Process payment
  await processPayment(paymentEvent.data)
  
  return { approved: true }
}
```

#### Webhook Await Example
```typescript
// server/queues/external-approval.ts

export default async function externalApproval(input: { requestId: string }, ctx) {
  // Send approval request email
  await sendApprovalEmail(input.requestId)
  
  // Wait for webhook callback (max 7 days)
  const trigger = await ctx.await.trigger({
    type: 'webhook',
    payload: { requestId: input.requestId },
    timeout: 7 * 24 * 60 * 60 * 1000
  })
  
  // Webhook URL: POST /api/_flows/triggers/{trigger.id}
  ctx.logger.info(`Waiting for webhook: POST /api/_flows/triggers/${trigger.id}`)
  
  const webhookData = await trigger.wait()
  
  return { 
    approved: webhookData.approved,
    comments: webhookData.comments 
  }
}
```

---

## 8. Migration Checklist

### Phase 1: Preparation
- [ ] Create new `lean-event-architecture.md` spec
- [ ] Review with team
- [ ] Set feature flag `LEAN_EVENTS=1` for gradual rollout

### Phase 2: Implementation
- [ ] Update event types (`EventRecord`)
- [ ] Implement Pub/Sub in Redis adapter
- [ ] Create simplified wiring (`flowWiring.ts`)
- [ ] Add client reducer composable
- [ ] Update SSE endpoints

### Phase 3: Migration
- [ ] Deploy with feature flag off (test in staging)
- [ ] Enable feature flag for 10% of traffic
- [ ] Monitor: latency, memory, error rate
- [ ] Gradually increase to 100%

### Phase 4: Cleanup
- [ ] Remove old projection wiring
- [ ] Delete unused streams: `nq:proj:*`
- [ ] Remove old types and utils
- [ ] Update documentation

---

## 9. Performance Testing

### Test Script: `test-lean-events.js`

```javascript
import IORedis from 'ioredis'

const redis = new IORedis()
const pubsub = new IORedis()

const flowId = 'test-' + Date.now()
const stream = `nq:flow:${flowId}`
const channel = `${stream}:live`

// Subscribe
let receivedCount = 0
await pubsub.subscribe(channel)
pubsub.on('message', (ch, msg) => {
  if (ch === channel) {
    receivedCount++
    console.log(`Received event #${receivedCount}`)
  }
})

// Publish 100 events
console.log('Publishing 100 events...')
const start = Date.now()

for (let i = 0; i < 100; i++) {
  const id = await redis.xadd(stream, '*', 
    'kind', 'log',
    'flow', flowId,
    'data', JSON.stringify({ level: 'info', msg: `Event ${i}` }),
    'ts', new Date().toISOString()
  )
  
  await redis.publish(channel, JSON.stringify({ id, kind: 'log', flow: flowId }))
}

const elapsed = Date.now() - start
console.log(`Published 100 events in ${elapsed}ms (${(elapsed/100).toFixed(2)}ms per event)`)

// Wait for all events
setTimeout(() => {
  console.log(`Received ${receivedCount}/100 events via Pub/Sub`)
  redis.quit()
  pubsub.quit()
}, 1000)
```

Expected results:
- Write latency: < 5ms per event
- Pub/Sub delivery: < 100ms total
- All 100 events received

---

## Summary

This lean architecture provides:

✅ **Single stream per flow** - simpler storage
✅ **Real-time Pub/Sub** - no polling, instant updates
✅ **Client-side reduction** - Motia-like experience
✅ **Horizontal scaling** - stateless instances
✅ **Minimal storage** - ~10KB per flow run

Ready to implement! 🚀
