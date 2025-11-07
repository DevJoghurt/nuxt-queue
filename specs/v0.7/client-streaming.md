# Client Streaming (Real-Time Events)

> **Version**: v0.7.0  
> **Status**: 📋 Planning  
> **Last Updated**: 2025-11-05  
> **Integrates With**: v0.6 (State Management), v0.8 (Event-Based Registry), v0.9 (Logging)

## Overview

v0.7 introduces client streaming - the ability for flows to push real-time events to clients via WebSockets. This enables use cases like:

- **AI Model Streaming**: Stream LLM tokens as they're generated
- **Progress Updates**: Real-time progress bars for long-running tasks
- **Live Logs**: Stream logs to client during execution
- **Status Changes**: Notify clients when flow state changes
- **Data Processing**: Stream results as they become available

**Key Concept**: When a flow is triggered, the client receives a `streamId` that can be used to subscribe to real-time events from that specific flow run via WebSocket.

### Key Features

1. **Flow-Scoped Streams** - Each flow run has its own client stream (`nq:client:{runId}`)
2. **WebSocket Subscription** - Clients subscribe using `streamId` = `runId`
3. **Bidirectional** - Worker pushes events, client receives in real-time
4. **Type-Safe Events** - Strongly typed event schemas with Zod
5. **Auto-Cleanup** - Streams expire when flow completes or TTL expires
6. **Framework Integration** - Works seamlessly with Nuxt's WebSocket layer

## 1. Basic Flow

### Step 1: Start Flow and Get Stream ID

Client triggers a flow and receives a `streamId` to subscribe to:

```typescript
// Client code (browser/app)
const response = await $fetch('/api/queue/ml-inference', {
  method: 'POST',
  body: {
    prompt: 'Explain quantum computing',
    model: 'gpt-4'
  }
})

// Response includes streamId for real-time updates
const { runId, streamId } = response
// streamId === runId (same value, but semantically different purpose)

console.log('Flow started:', runId)
console.log('Subscribe to stream:', streamId)
```

### Step 2: Subscribe to WebSocket Stream

Client connects to WebSocket and subscribes to the stream:

```typescript
// Client code - subscribe to real-time events
const ws = new WebSocket(`ws://localhost:3000/_nuxt-queue/stream/${streamId}`)

ws.onmessage = (event) => {
  const data = JSON.parse(event.data)
  
  switch (data.type) {
    case 'token':
      // AI token streaming
      appendToken(data.token)
      break
      
    case 'progress':
      // Progress updates
      updateProgressBar(data.percent)
      break
      
    case 'status':
      // Status changes
      updateStatus(data.status)
      break
      
    case 'complete':
      // Flow completed
      console.log('Flow completed:', data.result)
      ws.close()
      break
  }
}
```

### Step 3: Worker Pushes Events to Client

Worker code pushes events to the client stream:

```typescript
// server/queues/ml-inference.ts

export default defineQueueWorker(async (job, ctx) => {
  const { prompt, model } = job.data
  
  // Stream status update to client
  await ctx.client.send('status', { 
    status: 'generating',
    message: 'Starting model inference...'
  })
  
  // Call AI model with streaming
  const stream = await callAIModel(prompt, model)
  
  // Stream each token to client as it arrives
  for await (const token of stream) {
    await ctx.client.send('token', { token })
  }
  
  // Send completion event
  await ctx.client.send('complete', { 
    result: 'Generation complete',
    tokensGenerated: stream.totalTokens
  })
  
  return { status: 'success' }
})
```

## 2. Worker Context API

Workers get a `ctx.client` API for pushing events to subscribed clients:

```typescript
export default defineQueueWorker(async (job, ctx) => {
  // Send typed event to client
  await ctx.client.send('progress', { 
    percent: 25,
    message: 'Processing...'
  })
  
  // Send with custom metadata
  await ctx.client.send('data', { 
    chunk: data,
    index: 1
  }, {
    timestamp: true,  // Include timestamp
    priority: 'high'  // Priority hint for client
  })
  
  // Check if client is connected
  const hasListeners = await ctx.client.hasSubscribers()
  if (hasListeners) {
    // Only send expensive data if someone is listening
    await ctx.client.send('expensive-data', expensiveComputation())
  }
  
  // Broadcast to all subscribers (if multiple clients subscribe)
  await ctx.client.broadcast('notification', {
    message: 'Step completed'
  })
  
  return { status: 'done' }
})
```

## 3. Client Composable (Nuxt)

Nuxt composable for easy WebSocket subscription:

```vue
<script setup lang="ts">
// composables/useQueueStream.ts
const { streamId } = defineProps<{ streamId: string }>()

const { data, status, error } = useQueueStream(streamId, {
  onToken: (token: string) => {
    output.value += token
  },
  onProgress: (percent: number) => {
    progress.value = percent
  },
  onComplete: (result: any) => {
    console.log('Done:', result)
  }
})
</script>

<template>
  <div>
    <div v-if="status === 'connecting'">Connecting...</div>
    <div v-if="status === 'connected'">
      <pre>{{ output }}</pre>
      <progress :value="progress" max="100" />
    </div>
    <div v-if="error">Error: {{ error }}</div>
  </div>
</template>
```

### Composable Implementation

```typescript
// app/composables/useQueueStream.ts

export interface QueueStreamOptions {
  onToken?: (token: string) => void
  onProgress?: (percent: number, message?: string) => void
  onStatus?: (status: string, message?: string) => void
  onComplete?: (result: any) => void
  onError?: (error: Error) => void
  reconnect?: boolean  // Auto-reconnect on disconnect
  reconnectDelay?: number  // Delay between reconnect attempts
}

export function useQueueStream(streamId: string, options: QueueStreamOptions = {}) {
  const status = ref<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting')
  const error = ref<Error | null>(null)
  const data = ref<any[]>([])
  
  let ws: WebSocket | null = null
  
  const connect = () => {
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/_nuxt-queue/stream/${streamId}`
    
    ws = new WebSocket(wsUrl)
    
    ws.onopen = () => {
      status.value = 'connected'
      error.value = null
    }
    
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data)
      data.value.push(message)
      
      // Call type-specific handlers
      switch (message.type) {
        case 'token':
          options.onToken?.(message.data.token)
          break
        case 'progress':
          options.onProgress?.(message.data.percent, message.data.message)
          break
        case 'status':
          options.onStatus?.(message.data.status, message.data.message)
          break
        case 'complete':
          options.onComplete?.(message.data)
          break
      }
    }
    
    ws.onerror = (err) => {
      error.value = new Error('WebSocket error')
      status.value = 'error'
      options.onError?.(error.value)
    }
    
    ws.onclose = () => {
      status.value = 'disconnected'
      
      // Auto-reconnect if enabled
      if (options.reconnect) {
        setTimeout(connect, options.reconnectDelay || 1000)
      }
    }
  }
  
  const disconnect = () => {
    ws?.close()
    ws = null
  }
  
  // Connect on mount
  onMounted(connect)
  
  // Cleanup on unmount
  onUnmounted(disconnect)
  
  return {
    status,
    error,
    data,
    disconnect
  }
}
```

## 4. Event Schema Definition

Define typed events in flow config using Zod:

```typescript
// server/queues/ml-inference.ts
import { z } from 'zod'

const clientEvents = {
  token: z.object({
    token: z.string(),
    index: z.number().optional()
  }),
  
  progress: z.object({
    percent: z.number().min(0).max(100),
    message: z.string().optional()
  }),
  
  status: z.object({
    status: z.enum(['idle', 'generating', 'complete', 'error']),
    message: z.string().optional()
  }),
  
  complete: z.object({
    result: z.string(),
    tokensGenerated: z.number(),
    duration: z.number()
  })
}

export const config = defineQueueConfig({
  name: 'ml-inference',
  clientEvents  // Define allowed client events with schemas
})

export default defineQueueWorker(async (job, ctx) => {
  // Events are validated against schemas
  await ctx.client.send('token', { token: 'Hello' })  // ✓ Valid
  await ctx.client.send('token', { invalid: 'data' })  // ✗ Validation error
  
  await ctx.client.send('progress', { percent: 150 })  // ✗ Validation error (> 100)
})
```

## 5. Storage Architecture

Client streams use the **eventStore adapter** (unified architecture) but with a different stream key for routing:

### Stream Key Pattern

```typescript
// Client stream for a specific flow run (separate from flow events)
nq:client:{runId}

// Example
nq:client:abc-123

// Flow events:    nq:flow:abc-123    (internal, server-side)
// Client events:  nq:client:abc-123  (external, pushed to WebSocket)
```

### Event Format

```typescript
{
  id: '1699123456789-0',  // Redis Stream entry ID
  type: 'token',           // Event type
  data: {                  // Event data (validated by schema)
    token: 'Hello'
  },
  timestamp: '2025-11-05T10:00:00Z',
  runId: 'abc-123',
  flowName: 'ml-inference'
}
```

### Why Separate Stream?

Client streams are separate from flow streams for several reasons:

1. **Different Consumers**: Flow events consumed by workers, client events by WebSocket handlers
2. **Different TTL**: Client streams can expire sooner (short-lived, real-time)
3. **Network Boundary**: Client events cross network boundary, flow events stay server-side
4. **Rate Limiting**: Client streams may need different rate limits
5. **Security**: Client streams need access control, flow streams are internal
6. **Performance**: Can optimize caching/storage differently for real-time vs historical data

### EventStore Adapter Integration

All client stream operations go through eventStore adapter (no direct Redis access):

```typescript
// Worker code - uses eventStore adapter
export default defineQueueWorker(async (job, ctx) => {
  // ctx.client.send() internally calls:
  await eventStore.append(`nq:client:${runId}`, {
    type: 'token',
    data: { token: 'Hello' }
  })
  
  // Same adapter, different stream key = different wiring
})

// WebSocket handler - uses eventStore adapter
async function subscribeToClientStream(streamId: string) {
  // Query through eventStore adapter
  const events = await eventStore.query({
    stream: `nq:client:${streamId}`,
    follow: true  // Blocking read for real-time
  })
  
  for await (const event of events) {
    pushToWebSocket(event)
  }
}
```

### Wiring/Routing Logic

EventStore adapter routes to different streams based on key prefix:

```typescript
// src/runtime/server/eventStore/wiring.ts

export function getStreamType(streamKey: string): 'flow' | 'client' | 'registry' {
  if (streamKey.startsWith('nq:flow:')) return 'flow'
  if (streamKey.startsWith('nq:client:')) return 'client'
  if (streamKey.startsWith('nq:registry')) return 'registry'
  throw new Error(`Unknown stream type: ${streamKey}`)
}

// Different TTL based on stream type
export function getStreamTTL(streamType: string, status: string): number {
  switch (streamType) {
    case 'flow':
      return status === 'completed' ? 604800 : 86400  // 7d / 24h
    case 'client':
      return 300  // 5 minutes (short-lived)
    case 'registry':
      return 0  // No expiry (always-on)
  }
}

// EventStore adapter applies wiring automatically
class EventStoreAdapter {
  async append(stream: string, event: Event) {
    const type = getStreamType(stream)
    const ttl = getStreamTTL(type, event.status)
    
    // Append to Redis Stream
    await this.redis.xadd(stream, '*', ...fields)
    
    // Apply TTL based on stream type
    if (ttl > 0) {
      await this.redis.expire(stream, ttl)
    }
    
    // Invalidate cache (type-specific)
    await this.cache.invalidate(stream, type)
  }
}
```

### Stream Lifecycle

```typescript
// 1. Flow starts → client stream created automatically
await eventStore.append(`nq:client:${runId}`, {
  type: 'started',
  data: { flowName: 'ml-inference' }
})

// 2. Worker sends events → append via eventStore
await ctx.client.send('token', { token: 'Hi' })
// Internally: eventStore.append(`nq:client:${runId}`, ...)

// 3. WebSocket handler reads → query via eventStore
const events = await eventStore.query({
  stream: `nq:client:${runId}`,
  follow: true  // Blocking for real-time
})

// 4. Flow completes → TTL applied automatically by eventStore
// EventStore adapter detects stream type and applies 5min TTL
```

### Benefits of EventStore Integration

1. **Consistent Interface**: Same `append()` and `query()` API for all streams
2. **Unified Caching**: EventStore adapter caches client events too
3. **Adapter Agnostic**: Works with Redis, Postgres, Memory adapters
4. **Single Configuration**: Cache, TTL, trimming configured once
5. **No Direct DB Access**: All streams go through eventStore adapter layer

## 6. WebSocket Handler (Server)

Server-side WebSocket handler for managing client connections (uses eventStore adapter):

```typescript
// server/api/_nuxt-queue/stream/[streamId].ts

export default defineWebSocketHandler({
  async open(peer) {
    const streamId = peer.url.split('/').pop()
    const eventStore = useEventStore()
    
    // Validate streamId exists (via eventStore adapter)
    const stream = `nq:client:${streamId}`
    const exists = await eventStore.streamExists(stream)
    
    if (!exists) {
      peer.send(JSON.stringify({ error: 'Stream not found' }))
      peer.close()
      return
    }
    
    // Subscribe to stream via eventStore adapter
    subscribeToStream(streamId, peer, eventStore)
    
    console.log(`Client connected to stream: ${streamId}`)
  },
  
  async message(peer, message) {
    // Handle client messages (optional - for bidirectional)
    const data = JSON.parse(message.text())
    
    if (data.type === 'ping') {
      peer.send(JSON.stringify({ type: 'pong' }))
    }
  },
  
  async close(peer) {
    console.log('Client disconnected')
    // Cleanup handled automatically
  }
})
```

### EventStore Stream Subscription

Use eventStore adapter's `query()` with `follow: true` for real-time streaming:

```typescript
// Internal implementation - WebSocket event loop
async function subscribeToStream(
  streamId: string, 
  peer: Peer, 
  eventStore: EventStore
) {
  const stream = `nq:client:${streamId}`
  
  try {
    // Query with follow mode (blocking read)
    for await (const event of eventStore.query({
      stream,
      follow: true,        // Block until new events
      timeout: 5000,       // 5 second timeout
      startFrom: '0-0'     // Start from beginning
    })) {
      // Push event to WebSocket client
      if (peer.readyState === WebSocket.OPEN) {
        peer.send(JSON.stringify({
          type: event.type,
          data: event.data,
          timestamp: event.timestamp
        }))
        
        // Close connection after complete event
        if (event.type === 'complete') {
          setTimeout(() => peer.close(), 100)
          break
        }
      } else {
        // Client disconnected, stop streaming
        break
      }
    }
  } catch (error) {
    console.error('Stream subscription error:', error)
    peer.close()
  }
}
```

### EventStore Adapter Benefits

1. **No Direct Redis**: WebSocket handler never touches Redis directly
2. **Adapter Agnostic**: Works with any eventStore backend (Redis, Postgres, Memory)
3. **Caching**: EventStore adapter may cache client events for performance
4. **Consistent**: Same query interface as flow events, just different stream key
5. **Follow Mode**: EventStore adapter handles blocking reads internally

## 7. Complete Example: AI Streaming

### API Endpoint (Start Flow)

```typescript
// server/api/ai/generate.post.ts

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  
  // Start flow and get runId
  const { runId } = await startFlow('ml-inference', {
    prompt: body.prompt,
    model: body.model || 'gpt-4'
  })
  
  // Return streamId for client subscription
  return {
    runId,
    streamId: runId,  // streamId === runId
    streamUrl: `/api/_nuxt-queue/stream/${runId}`
  }
})
```

### Worker (Stream Tokens)

```typescript
// server/queues/ml-inference.ts

export const config = defineQueueConfig({
  name: 'ml-inference',
  clientEvents: {
    token: z.object({
      token: z.string(),
      index: z.number()
    }),
    complete: z.object({
      totalTokens: z.number(),
      duration: z.number()
    })
  }
})

export default defineQueueWorker(async (job, ctx) => {
  const { prompt, model } = job.data
  
  ctx.logger.info('Starting AI generation', { prompt, model })
  
  // Call OpenAI with streaming
  const response = await openai.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    stream: true
  })
  
  let tokenIndex = 0
  const startTime = Date.now()
  
  // Stream each token to client
  for await (const chunk of response) {
    const token = chunk.choices[0]?.delta?.content
    
    if (token) {
      // Push token to client stream
      await ctx.client.send('token', {
        token,
        index: tokenIndex++
      })
    }
  }
  
  const duration = Date.now() - startTime
  
  // Send completion event
  await ctx.client.send('complete', {
    totalTokens: tokenIndex,
    duration
  })
  
  ctx.logger.info('Generation complete', { tokens: tokenIndex, duration })
  
  return {
    status: 'success',
    totalTokens: tokenIndex,
    duration
  }
})
```

### Client Component

```vue
<script setup lang="ts">
const prompt = ref('')
const output = ref('')
const status = ref<'idle' | 'generating' | 'complete'>('idle')
const streamId = ref<string | null>(null)

async function generate() {
  status.value = 'generating'
  output.value = ''
  
  // Start flow
  const response = await $fetch('/api/ai/generate', {
    method: 'POST',
    body: { prompt: prompt.value }
  })
  
  streamId.value = response.streamId
  
  // Subscribe to stream
  const ws = new WebSocket(`ws://localhost:3000/_nuxt-queue/stream/${streamId.value}`)
  
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data)
    
    if (message.type === 'token') {
      output.value += message.data.token
    } else if (message.type === 'complete') {
      status.value = 'complete'
      console.log('Generation complete:', message.data)
      ws.close()
    }
  }
  
  ws.onerror = () => {
    status.value = 'idle'
    console.error('WebSocket error')
  }
}
</script>

<template>
  <div>
    <textarea v-model="prompt" placeholder="Enter prompt..." />
    <button @click="generate" :disabled="status === 'generating'">
      {{ status === 'generating' ? 'Generating...' : 'Generate' }}
    </button>
    
    <div v-if="output" class="output">
      <pre>{{ output }}</pre>
    </div>
    
    <div v-if="status === 'complete'" class="status">
      ✓ Generation complete
    </div>
  </div>
</template>
```

## 8. Advanced Features

### Rate Limiting

Prevent overwhelming clients with too many events:

```typescript
export default defineQueueWorker(async (job, ctx) => {
  let buffer = ''
  let lastSend = Date.now()
  const minInterval = 50  // Max 20 events/second
  
  for await (const token of stream) {
    buffer += token
    
    const elapsed = Date.now() - lastSend
    
    if (elapsed >= minInterval || buffer.length > 100) {
      await ctx.client.send('token', { token: buffer })
      buffer = ''
      lastSend = Date.now()
    }
  }
  
  // Flush remaining buffer
  if (buffer) {
    await ctx.client.send('token', { token: buffer })
  }
})
```

### Conditional Streaming

Only stream if client is subscribed (save resources):

```typescript
export default defineQueueWorker(async (job, ctx) => {
  // Check if anyone is listening
  const hasSubscribers = await ctx.client.hasSubscribers()
  
  if (hasSubscribers) {
    // Stream detailed progress
    for (const step of steps) {
      await ctx.client.send('progress', {
        step: step.name,
        percent: step.progress
      })
      await processStep(step)
    }
  } else {
    // No subscribers, just process without streaming
    for (const step of steps) {
      await processStep(step)
    }
  }
})
```

### Error Streaming

Stream errors to client for better UX:

```typescript
export default defineQueueWorker(async (job, ctx) => {
  try {
    await ctx.client.send('status', { status: 'processing' })
    
    const result = await processData(job.data)
    
    await ctx.client.send('complete', { result })
    
  } catch (error) {
    // Stream error to client
    await ctx.client.send('error', {
      message: error.message,
      code: error.code,
      retryable: isRetryable(error)
    })
    
    throw error  // Still throw for flow error handling
  }
})
```

### Multi-Stage Streaming

Stream different types of events for complex workflows:

```typescript
export default defineQueueWorker(async (job, ctx) => {
  // Stage 1: Data loading
  await ctx.client.send('stage', { 
    name: 'loading',
    status: 'started'
  })
  
  const data = await loadData(job.data.source)
  
  await ctx.client.send('stage', { 
    name: 'loading',
    status: 'complete',
    rowsLoaded: data.length
  })
  
  // Stage 2: Processing with progress
  await ctx.client.send('stage', { 
    name: 'processing',
    status: 'started'
  })
  
  for (let i = 0; i < data.length; i++) {
    await processRow(data[i])
    
    // Send progress every 10%
    if (i % Math.floor(data.length / 10) === 0) {
      await ctx.client.send('progress', {
        percent: (i / data.length) * 100,
        processed: i,
        total: data.length
      })
    }
  }
  
  await ctx.client.send('stage', { 
    name: 'processing',
    status: 'complete'
  })
  
  // Stage 3: Results
  await ctx.client.send('complete', {
    totalProcessed: data.length,
    duration: ctx.duration
  })
})
```

## 9. Security Considerations

### Stream Access Control

Only allow clients to subscribe to streams they own:

```typescript
// server/api/_nuxt-queue/stream/[streamId].ts

export default defineWebSocketHandler({
  async open(peer) {
    const streamId = getRouterParam(peer.url, 'streamId')
    const userId = await getUserFromSession(peer.request)
    
    // Verify user owns this stream
    const stream = await getStreamMetadata(streamId)
    
    if (stream.userId !== userId) {
      peer.send(JSON.stringify({ error: 'Unauthorized' }))
      peer.close()
      return
    }
    
    peer.subscribe({ stream: `nq:client:${streamId}` })
  }
})
```

### Stream Metadata

Store ownership info when creating stream (via eventStore adapter):

```typescript
// When starting flow - append metadata event
await eventStore.append(`nq:client:${runId}`, {
  type: 'stream.created',
  data: {
    userId: session.userId,
    createdAt: Date.now(),
    expiresAt: Date.now() + (5 * 60 * 1000)  // 5 minutes
  }
})

// Or use separate metadata stream (optional)
await eventStore.setMetadata(`nq:client:${runId}`, {
  userId: session.userId,
  createdAt: Date.now()
})
```

### Rate Limiting

Limit connections per user (via eventStore or separate counter):

```typescript
// Using eventStore for connection tracking
const connections = await eventStore.incrementCounter(`connections:${userId}`)

if (connections > 10) {
  peer.send(JSON.stringify({ error: 'Too many connections' }))
  peer.close()
  return
}

// Cleanup on disconnect
peer.on('close', () => {
  eventStore.decrementCounter(`connections:${userId}`)
})

// Or use Redis directly for counters (outside event streams)
// This is one of the few cases where direct Redis access is OK
```

## 10. Configuration

```typescript
export default defineNuxtConfig({
  queue: {
    client: {
      enabled: true,
      
      // Stream configuration
      stream: {
        ttl: 300,  // 5 minutes after flow completes
        maxEvents: 10000,  // Max events per stream
        trimStrategy: 'maxlen'  // Redis MAXLEN trimming
      },
      
      // WebSocket configuration
      websocket: {
        path: '/_nuxt-queue/stream',
        heartbeatInterval: 30000,  // 30 seconds
        maxConnections: 100  // Per instance
      },
      
      // Rate limiting
      rateLimit: {
        enabled: true,
        maxEventsPerSecond: 100,
        burstSize: 20
      }
    }
  }
})
```

## 11. Implementation Checklist

- [ ] Create `ctx.client.send()` API in worker context
- [ ] Implement Redis Stream append for client events
- [ ] Create WebSocket handler for stream subscriptions
- [ ] Add event schema validation with Zod
- [ ] Implement `hasSubscribers()` check
- [ ] Add `useQueueStream()` composable
- [ ] Create stream access control
- [ ] Add rate limiting for client events
- [ ] Implement stream TTL and cleanup
- [ ] Add connection limits per user
- [ ] Write tests for streaming scenarios
- [ ] Document API and examples
- [ ] Add monitoring for WebSocket connections
- [ ] Performance testing for high-frequency streaming

## 12. Benefits

### For Developers

- **Real-Time UX**: Stream AI responses, progress, status to users
- **Type Safety**: Zod schemas for client events with TypeScript inference
- **Simple API**: `ctx.client.send()` - no WebSocket complexity in workers
- **Framework Integration**: Works seamlessly with Nuxt/Vue

### For Users

- **Instant Feedback**: See AI generation in real-time, not after completion
- **Progress Visibility**: Know exactly what's happening during long tasks
- **Better UX**: No more "Loading..." spinners for 30 seconds

### For Architecture

- **Unified Storage**: Client streams use same Redis Streams as everything else
- **Scalable**: Redis Streams + WebSockets scale to thousands of connections
- **Decoupled**: Workers push events, WebSocket handlers consume independently
- **Observable**: All client events logged in Redis for debugging

## 13. Future Enhancements

### Stream Replay

Allow clients to replay streams from beginning:

```typescript
const { data } = useQueueStream(streamId, {
  mode: 'replay',  // Replay from start
  speed: 2  // 2x speed
})
```

### Stream Persistence

Archive streams for later viewing:

```typescript
export const config = defineQueueConfig({
  client: {
    persist: true,  // Keep stream after TTL
    storage: 's3'   // Archive to S3
  }
})
```

### Client → Worker Events

Allow clients to send events back to workers:

```typescript
// Client sends cancel request
ws.send(JSON.stringify({ type: 'cancel' }))

// Worker receives and handles
ctx.client.on('cancel', async () => {
  ctx.logger.info('Client requested cancellation')
  throw new Error('Cancelled by user')
})
```
