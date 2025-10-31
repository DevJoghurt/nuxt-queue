# State Management & Logging Enhancements

> **Version**: v0.6.2 (State), v0.7.0 (Logging)  
> **Status**: 📋 Planning  
> **Last Updated**: 2025-10-30

## 1. Unified State and Stream Store

### Goal

Eliminate the separate state provider by storing state as events in the stream.

### Current Problem

We have two separate systems:
1. **Stream Store**: Events in Redis Streams
2. **State Provider**: Key-value in Redis

This creates:
- Complexity (two systems to maintain)
- Inconsistency (state and events can diverge)
- Performance overhead (two round-trips)

### Proposed Solution

Store state operations as events in the stream:

```typescript
// Instead of separate state storage:
await ctx.state.set('model_version', '1.0')

// Becomes an event:
{
  type: 'state.set',
  runId: 'abc-123',
  flowName: 'ml-flow',
  stepName: 'train_model',
  data: {
    key: 'model_version',
    value: '1.0'
  }
}
```

### State Reconstruction

State is computed by reducing events:

```typescript
function reduceState(events: EventRecord[]): Record<string, any> {
  const state = {}
  
  for (const event of events) {
    if (event.type === 'state.set') {
      state[event.data.key] = event.data.value
    } else if (event.type === 'state.delete') {
      delete state[event.data.key]
    }
  }
  
  return state
}
```

### Performance Optimization

Cache latest state in Redis with TTL:

```typescript
// Write-through cache
async function setState(key: string, value: any) {
  // Append event (source of truth)
  await streamStore.append('nq:flow:abc-123', {
    type: 'state.set',
    data: { key, value }
  })
  
  // Update cache
  await redis.setex(`nq:flow:abc-123:state:${key}`, 3600, JSON.stringify(value))
}

// Read-through cache
async function getState(key: string) {
  // Try cache first
  const cached = await redis.get(`nq:flow:abc-123:state:${key}`)
  if (cached) return JSON.parse(cached)
  
  // Cache miss: reduce events
  const events = await streamStore.read('nq:flow:abc-123')
  const state = reduceState(events)
  
  // Populate cache
  for (const [k, v] of Object.entries(state)) {
    await redis.setex(`nq:flow:abc-123:state:${k}`, 3600, JSON.stringify(v))
  }
  
  return state[key]
}
```

### Benefits

- **Single Source of Truth**: All changes in event stream
- **Auditability**: Full history of state changes
- **Time Travel**: Reconstruct state at any point
- **Simplicity**: One system instead of two
- **Consistency**: State and events always in sync

### Migration

1. Add `state.*` event types
2. Implement cache layer
3. Update `ctx.state` to use events
4. Deprecate old state provider
5. Remove state provider code

## 2. Better Logger Implementation

### Goal

Enhance logging with adapters, structured logging, and observability integrations.

### Current Limitations

- Basic console logging only
- No structured logging
- No external integrations
- Limited filtering

### Proposed Architecture

```typescript
interface LoggerAdapter {
  log(entry: LogEntry): Promise<void>
  query(filter: LogFilter): Promise<LogEntry[]>
  close(): Promise<void>
}

interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  timestamp: string
  flowId?: string
  stepName?: string
  metadata?: Record<string, any>
  context?: {
    queue?: string
    jobId?: string
    [key: string]: any
  }
}
```

### Adapters

#### Console (current)
```typescript
export class ConsoleLogger implements LoggerAdapter {
  async log(entry: LogEntry) {
    console[entry.level](entry.message, entry.metadata)
  }
}
```

#### Pino (structured)
```typescript
export class PinoLogger implements LoggerAdapter {
  private logger = pino({
    level: 'info',
    transport: {
      target: 'pino-pretty'
    }
  })
  
  async log(entry: LogEntry) {
    this.logger[entry.level]({
      msg: entry.message,
      flowId: entry.flowId,
      stepName: entry.stepName,
      ...entry.metadata
    })
  }
}
```

#### Datadog
```typescript
export class DatadogLogger implements LoggerAdapter {
  async log(entry: LogEntry) {
    await this.datadog.log({
      level: entry.level,
      message: entry.message,
      service: 'nuxt-queue',
      ddsource: 'nodejs',
      ddtags: `flow:${entry.flowId},step:${entry.stepName}`,
      ...entry.metadata
    })
  }
}
```

#### Elasticsearch
```typescript
export class ElasticsearchLogger implements LoggerAdapter {
  async log(entry: LogEntry) {
    await this.client.index({
      index: 'queue-logs',
      document: entry
    })
  }
  
  async query(filter: LogFilter) {
    const result = await this.client.search({
      index: 'queue-logs',
      query: { match: { flowId: filter.flowId } }
    })
    return result.hits.hits.map(h => h._source)
  }
}
```

### Configuration

```typescript
export default defineNuxtConfig({
  queue: {
    logger: {
      name: 'pino',  // or 'console', 'datadog', 'elasticsearch'
      level: 'info',
      adapters: [
        { name: 'console', level: 'debug' },
        { name: 'datadog', level: 'error', apiKey: '...' }
      ]
    }
  }
})
```

### Features

- **Structured Logging**: JSON output with context
- **Multiple Adapters**: Log to multiple destinations
- **Log Levels**: Fine-grained control
- **Filtering**: Query logs by flow, step, level
- **Sampling**: Reduce log volume in production
- **Correlation IDs**: Trace requests across services

### Benefits

- Better observability
- Integration with monitoring tools
- Easier debugging
- Production-ready logging
