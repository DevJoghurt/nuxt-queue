# Worker Execution Modes

> **Version**: v0.7.0  
> **Status**: 📋 Planning  
> **Last Updated**: 2025-10-30

## Goal

Provide flexible execution modes for workers - queue-based, HTTP endpoints, or standalone processing.

## 1. Workers Callable Without Queue/Flow

### Current Limitation

Workers can only be invoked through BullMQ queues:
```typescript
// Must go through queue
await queueProvider.enqueue('my-worker', { data })
```

### Proposed Enhancement

Workers can also be called directly as HTTP handlers:

```typescript
// server/queues/tasks/send-email.ts
export default defineQueueWorker(async (job, ctx) => {
  await sendEmail(job.data.to, job.data.subject, job.data.body)
  return { sent: true }
})

export const config = defineQueueConfig({
  // Enable HTTP endpoint
  http: {
    path: '/api/tasks/send-email',
    method: 'POST',
    auth: true
  }
})
```

**Generated Endpoint**:
```
POST /api/tasks/send-email
Body: { to: "user@example.com", subject: "...", body: "..." }
Response: { sent: true }
```

### Implementation

Auto-generate Nitro event handlers at build time:

```typescript
// Generated: .output/server/api/tasks/send-email.post.ts
import { defineEventHandler } from 'h3'
import handler from '~/server/queues/tasks/send-email'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  
  // Build minimal context
  const ctx = buildContext({
    queue: 'tasks',
    logger: /* ... */
  })
  
  // Call worker directly
  const result = await handler({ data: body }, ctx)
  
  return result
})
```

### Modes

```typescript
export const config = defineQueueConfig({
  mode: 'queue' | 'http' | 'both',
  http: {
    path: '/api/...',
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    auth?: boolean | ((event) => boolean),
    schema?: ZodSchema  // Validation
  }
})
```

### Benefits

- **Synchronous Calls**: Get immediate results
- **Lower Latency**: No queue overhead
- **Simpler Testing**: Call as regular functions
- **Flexibility**: Use workers for both patterns
- **Gradual Migration**: Existing workers still work

## 2. Queue Workers Without Flows

### Current State

Workers can already run independently, but the flow system adds overhead.

### Enhancement

Make flow orchestration fully optional:

```typescript
// Simple queue worker (no flow)
export default defineQueueWorker(async (job, ctx) => {
  await processTask(job.data)
  return { success: true }
})

export const config = defineQueueConfig({
  concurrency: 10,
  // No flow config = standalone worker
})
```

### Usage

```typescript
// Enqueue directly
await queueProvider.enqueue('my-worker', {
  name: 'my-worker',
  data: { task: 'do something' }
})

// No flow events generated
// No flow tracking
// Just queue processing
```

### Benefits

- **Simpler**: No flow overhead for basic jobs
- **Faster**: Skip flow engine
- **Clearer**: Explicit about worker purpose

## Use Cases

### HTTP Mode
- Webhooks that need immediate response
- API endpoints for synchronous operations
- Real-time processing
- Testing and debugging

### Queue Mode (with flows)
- Complex multi-step workflows
- Asynchronous processing
- Job retries and error handling
- Flow orchestration

### Queue Mode (without flows)
- Simple background jobs
- Task queues
- Batch processing
- No orchestration needed

### Both Modes
- Flexible execution based on caller
- HTTP for urgent, queue for batched
- Synchronous + asynchronous patterns
