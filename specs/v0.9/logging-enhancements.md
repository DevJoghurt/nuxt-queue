# Logging Enhancements

> **Version**: v0.9.0  
> **Status**: 📋 Planning  
> **Last Updated**: 2025-11-05  
> **Depends On**: v0.8 (Event-Based Registry)

## Overview

v0.9 introduces comprehensive logging with flexible routing, adapter-based architecture, and deep integration with v0.8's distributed event system. Logs can be routed to the internal eventStore (as flow events), external providers (Datadog, Elasticsearch), or both.

### Key Features

1. **Three-Tier Routing** - Internal eventStore, external providers, or both
2. **EventStore Integration** - Logs as events in flow streams (part of flow history)
3. **Logger Adapters** - Pluggable backends (Console, Pino, Datadog, Elasticsearch)
4. **Structured Logging** - JSON output with rich context from v0.8 registry
5. **Query Interface** - Search and filter logs programmatically
6. **Flow Context** - Automatic correlation with distributed flows

## 1. Log Routing Strategy

### Three Routing Modes

```typescript
type LogRouting = 'internal' | 'external' | 'both'

// 'internal' - Logs go to eventStore only (part of flow events)
// 'external' - Logs go to external providers only (Datadog, ES, etc.)
// 'both'     - Logs to eventStore AND external providers
```

### When to Use Each Mode

| Mode | Use Case | Benefits | Considerations |
|------|----------|----------|----------------|
| **internal** | Local dev, debugging flows | • Simple setup<br>• Logs in flow history<br>• No external dependencies | • Limited to eventStore capacity<br>• No external dashboards |
| **external** | Production with monitoring | • External observability<br>• Alerts & dashboards<br>• Lower eventStore load | • Requires external service<br>• Additional cost |
| **both** | Production with full tracing | • Complete flow history<br>• External monitoring<br>• Best observability | • Higher storage cost<br>• Duplicate logs |

### Configuration

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  queue: {
    logger: {
      // Routing mode
      routing: 'both',  // 'internal' | 'external' | 'both' (default: 'internal')
      
      // Internal logging (eventStore)
      internal: {
        enabled: true,
        level: 'info'
        // Automatically uses existing nq:flow:{runId} stream
      },
      
      // External logging
      external: {
        enabled: true,
        level: 'warn',  // Less verbose externally
        adapter: 'datadog',
        options: {
          apiKey: process.env.DD_API_KEY,
          service: 'nuxt-queue'
        }
      }
    }
  }
})
```

## 2. Internal Logging (EventStore Adapter)

### Logs as Flow Events

Internal logs are stored as events in the existing flow stream (`nq:flow:{runId}`), making them part of the flow execution history alongside step events and state changes:

```typescript
// When you log:
ctx.logger.info('Training complete', { accuracy: 0.95 })

// This creates an event in the flow's event stream:
// Stream: nq:flow:abc-123 (same stream as flow execution events)
{
  type: 'log.info',
  data: {
    level: 'info',
    message: 'Training complete',
    timestamp: '2025-11-05T10:00:00Z',
    flowName: 'ml-pipeline',
    runId: 'abc-123',
    stepName: 'train',
    instanceId: 'ml-worker-1',
    workerId: 'train-worker',
    queue: 'ml-train',
    metadata: { accuracy: 0.95 }
  }
}
```

**Timeline in Flow Stream:**

```typescript
// Stream: nq:flow:abc-123
// All events for this flow run in chronological order:

{ type: 'flow.step.started', data: { stepName: 'train', ... } }
{ type: 'log.info', data: { message: 'Training started', ... } }
{ type: 'log.debug', data: { message: 'Epoch 1/10 complete', ... } }
{ type: 'state.set', data: { key: 'accuracy', value: 0.85 } }
{ type: 'log.debug', data: { message: 'Epoch 5/10 complete', ... } }
{ type: 'state.set', data: { key: 'accuracy', value: 0.95 } }
{ type: 'log.info', data: { message: 'Training complete', ... } }
{ type: 'flow.step.completed', data: { stepName: 'train', ... } }
```

### EventStore Adapter Implementation

```typescript
// src/runtime/server/logger/adapters/eventstore.ts

export class EventStoreLoggerAdapter implements LoggerAdapter {
  constructor(
    private eventManager: EventManager,
    private options: {
      trim?: { maxLen: number; approx: boolean }
    } = {}
  ) {}
  
  async log(entry: LogEntry) {
    // Always use the flow's event stream
    const stream = `nq:flow:${entry.runId}`
    
    // Store log as event in the same stream as flow execution
    await this.eventManager.emit(`log.${entry.level}`, entry, {
      stream,
      trim: this.options.trim
    })
  }
  
  async query(filter: LogFilter): Promise<LogEntry[]> {
    if (!filter.runId) {
      throw new Error('runId is required for internal log queries')
    }
    
    const stream = `nq:flow:${filter.runId}`
    
    // Query log events from flow stream
    const events = await this.eventManager.query({
      stream,
      types: filter.level 
        ? (Array.isArray(filter.level) ? filter.level.map(l => `log.${l}`) : [`log.${filter.level}`])
        : ['log.debug', 'log.info', 'log.warn', 'log.error'],
      since: filter.startTime,
      until: filter.endTime,
      limit: filter.limit || 100
    })
    
    // Filter by additional criteria
    return events
      .map(e => e.data as LogEntry)
      .filter(entry => {
        if (filter.flowName && entry.flowName !== filter.flowName) return false
        if (filter.stepName && entry.stepName !== filter.stepName) return false
        if (filter.instanceId && entry.instanceId !== filter.instanceId) return false
        return true
      })
  }
  
  async close() {
    // EventManager handles cleanup
  }
}
```

### Benefits of Single Stream Approach

**Why this is better than separate log streams:**

✅ **No New Infrastructure** - Reuses existing `nq:flow:{runId}` stream
✅ **Single Source of Truth** - All flow data (events, logs, state) in one place
✅ **Automatic Cleanup** - Logs cleaned up with flow TTL automatically
✅ **Simpler Queries** - One stream read = complete flow history with logs
✅ **Better Context** - Logs interleaved with execution events show exact timing
✅ **Less Overhead** - No additional streams to manage or configure
✅ **Consistent** - Same pattern as v0.6 state events

**Complete Flow History:**

Reading a single stream gives you everything:
- Flow execution events (started, completed, triggered)
- Log entries (debug, info, warn, error)
- State changes (set, delete)
- All in chronological order

## 3. Logger Architecture

### Core Interfaces

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
  
  // Flow context (auto-injected from v0.8 registry)
  flowName?: string
  runId?: string
  stepName?: string
  
  // Instance context (from v0.8 event-based registry)
  instanceId?: string
  workerId?: string
  queue?: string
  
  // Job context
  jobId?: string
  attemptNumber?: number
  
  // Custom metadata
  metadata?: Record<string, any>
  
  // Additional context
  context?: {
    [key: string]: any
  }
}

interface LogFilter {
  level?: LogEntry['level'] | LogEntry['level'][]
  flowName?: string
  runId?: string
  stepName?: string
  instanceId?: string
  startTime?: string
  endTime?: string
  limit?: number
}
```

### Usage in Workers

```typescript
export default defineQueueWorker(async (job, ctx) => {
  // Automatic flow context injection from v0.8 registry
  ctx.logger.info('Starting ML training')
  // Routes to: eventStore + external (based on routing config)
  // Context auto-includes: flowName, runId, stepName, instanceId, workerId, queue
  
  try {
    const result = await trainModel(job.data)
    
    // Log with custom metadata
    ctx.logger.info('Training complete', {
      accuracy: result.accuracy,
      epochs: result.epochs
    })
    
    return result
  } catch (error) {
    // Errors auto-include stack traces
    ctx.logger.error('Training failed', { error })
    throw error
  }
})
```

## 4. External Adapters

### Console Adapter

Simple console output with optional colors:

```typescript
// src/runtime/server/logger/adapters/console.ts

export class ConsoleLoggerAdapter implements LoggerAdapter {
  constructor(private options: { colors?: boolean; pretty?: boolean } = {}) {}
  
  async log(entry: LogEntry) {
    const prefix = this.formatPrefix(entry)
    const message = this.options.pretty 
      ? this.formatPretty(entry) 
      : JSON.stringify(entry)
    
    console[entry.level](prefix, message)
  }
  
  private formatPrefix(entry: LogEntry): string {
    const timestamp = new Date(entry.timestamp).toISOString()
    const level = entry.level.toUpperCase().padEnd(5)
    const flow = entry.flowName ? `[${entry.flowName}/${entry.stepName}]` : ''
    const instance = entry.instanceId ? `(${entry.instanceId})` : ''
    
    return `${timestamp} ${level} ${flow}${instance}`
  }
  
  private formatPretty(entry: LogEntry): string {
    const parts = [entry.message]
    
    if (entry.runId) parts.push(`runId=${entry.runId}`)
    if (entry.metadata) parts.push(JSON.stringify(entry.metadata))
    
    return parts.join(' ')
  }
  
  async query(filter: LogFilter): Promise<LogEntry[]> {
    throw new Error('Console adapter does not support queries')
  }
  
  async close() {}
}
```

**Configuration:**

```typescript
export default defineNuxtConfig({
  queue: {
    logger: {
      routing: 'external',
      external: {
        adapter: 'console',
        options: {
          colors: true,
          pretty: true
        }
      }
    }
  }
})
```

### Pino Adapter

High-performance structured logging:

```typescript
// src/runtime/server/logger/adapters/pino.ts

import pino from 'pino'

export class PinoLoggerAdapter implements LoggerAdapter {
  private logger: pino.Logger
  
  constructor(options: pino.LoggerOptions = {}) {
    this.logger = pino({
      level: 'info',
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname'
        }
      },
      ...options
    })
  }
  
  async log(entry: LogEntry) {
    this.logger[entry.level]({
      msg: entry.message,
      flowName: entry.flowName,
      runId: entry.runId,
      stepName: entry.stepName,
      instanceId: entry.instanceId,
      workerId: entry.workerId,
      queue: entry.queue,
      jobId: entry.jobId,
      ...entry.metadata,
      ...entry.context
    })
  }
  
  async query(filter: LogFilter): Promise<LogEntry[]> {
    throw new Error('Pino adapter does not support queries. Use EventStore or Elasticsearch.')
  }
  
  async close() {
    this.logger.flush()
  }
}
```

### Datadog Adapter

Send logs to Datadog APM:

```typescript
// src/runtime/server/logger/adapters/datadog.ts

export class DatadogLoggerAdapter implements LoggerAdapter {
  constructor(private options: {
    apiKey: string
    service: string
    hostname?: string
    tags?: string[]
  }) {}
  
  async log(entry: LogEntry) {
    const tags = [
      `flow:${entry.flowName}`,
      `step:${entry.stepName}`,
      `instance:${entry.instanceId}`,
      ...(this.options.tags || [])
    ].filter(Boolean)
    
    await fetch('https://http-intake.logs.datadoghq.com/v1/input', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'DD-API-KEY': this.options.apiKey
      },
      body: JSON.stringify({
        ddsource: 'nodejs',
        ddtags: tags.join(','),
        service: this.options.service,
        hostname: this.options.hostname || entry.instanceId,
        message: entry.message,
        level: entry.level,
        timestamp: entry.timestamp,
        ...entry.metadata
      })
    })
  }
  
  async query(filter: LogFilter): Promise<LogEntry[]> {
    // Query via Datadog API
    const query = this.buildDatadogQuery(filter)
    
    const response = await fetch(
      `https://api.datadoghq.com/api/v2/logs/events/search`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'DD-API-KEY': this.options.apiKey
        },
        body: JSON.stringify({ query })
      }
    )
    
    const data = await response.json()
    return data.data.map(log => this.parseDatadogLog(log))
  }
  
  private buildDatadogQuery(filter: LogFilter): string {
    const conditions = []
    
    if (filter.flowName) conditions.push(`@flowName:${filter.flowName}`)
    if (filter.runId) conditions.push(`@runId:${filter.runId}`)
    if (filter.level) conditions.push(`@level:${filter.level}`)
    
    return conditions.join(' AND ')
  }
  
  async close() {}
}
```

### Elasticsearch Adapter

Store logs in Elasticsearch for advanced querying:

```typescript
// src/runtime/server/logger/adapters/elasticsearch.ts

import { Client } from '@elastic/elasticsearch'

export class ElasticsearchLoggerAdapter implements LoggerAdapter {
  private client: Client
  private index: string
  
  constructor(options: {
    node: string
    auth?: { username: string; password: string }
    index?: string
  }) {
    this.client = new Client({
      node: options.node,
      auth: options.auth
    })
    this.index = options.index || 'queue-logs'
  }
  
  async log(entry: LogEntry) {
    await this.client.index({
      index: this.index,
      document: {
        '@timestamp': entry.timestamp,
        level: entry.level,
        message: entry.message,
        flow: {
          name: entry.flowName,
          runId: entry.runId,
          step: entry.stepName
        },
        instance: {
          id: entry.instanceId,
          workerId: entry.workerId,
          queue: entry.queue
        },
        job: {
          id: entry.jobId,
          attempt: entry.attemptNumber
        },
        metadata: entry.metadata,
        context: entry.context
      }
    })
  }
  
  async query(filter: LogFilter): Promise<LogEntry[]> {
    const must: any[] = []
    
    if (filter.flowName) must.push({ match: { 'flow.name': filter.flowName } })
    if (filter.runId) must.push({ match: { 'flow.runId': filter.runId } })
    if (filter.level) {
      const levels = Array.isArray(filter.level) ? filter.level : [filter.level]
      must.push({ terms: { level: levels } })
    }
    if (filter.startTime || filter.endTime) {
      const range: any = {}
      if (filter.startTime) range.gte = filter.startTime
      if (filter.endTime) range.lte = filter.endTime
      must.push({ range: { '@timestamp': range } })
    }
    
    const result = await this.client.search({
      index: this.index,
      size: filter.limit || 100,
      sort: [{ '@timestamp': 'desc' }],
      query: { bool: { must } }
    })
    
    return result.hits.hits.map(hit => this.parseElasticsearchDoc(hit._source))
  }
  
  private parseElasticsearchDoc(doc: any): LogEntry {
    return {
      level: doc.level,
      message: doc.message,
      timestamp: doc['@timestamp'],
      flowName: doc.flow?.name,
      runId: doc.flow?.runId,
      stepName: doc.flow?.step,
      instanceId: doc.instance?.id,
      workerId: doc.instance?.workerId,
      queue: doc.instance?.queue,
      jobId: doc.job?.id,
      attemptNumber: doc.job?.attempt,
      metadata: doc.metadata,
      context: doc.context
    }
  }
  
  async close() {
    await this.client.close()
  }
}
```

## 5. Router Implementation

### Log Router with Routing Modes

```typescript
// src/runtime/server/logger/router.ts

export class LogRouter implements LoggerAdapter {
  private internalAdapter?: LoggerAdapter
  private externalAdapter?: LoggerAdapter
  private routing: LogRouting
  
  constructor(config: LoggerConfig, eventManager: EventManager) {
    this.routing = config.routing || 'internal'
    
    // Setup internal adapter (eventStore)
    if (this.routing === 'internal' || this.routing === 'both') {
      if (config.internal?.enabled !== false) {
        this.internalAdapter = new EventStoreLoggerAdapter(eventManager, {
          trim: config.internal?.trim
        })
      }
    }
    
    // Setup external adapter
    if (this.routing === 'external' || this.routing === 'both') {
      if (config.external?.enabled) {
        this.externalAdapter = this.createExternalAdapter(config.external)
      }
    }
  }
  
  async log(entry: LogEntry) {
    const promises: Promise<void>[] = []
    
    // Route to internal (check level)
    if (this.internalAdapter && this.shouldLogInternal(entry)) {
      promises.push(this.internalAdapter.log(entry))
    }
    
    // Route to external (check level)
    if (this.externalAdapter && this.shouldLogExternal(entry)) {
      promises.push(this.externalAdapter.log(entry))
    }
    
    await Promise.all(promises)
  }
  
  async query(filter: LogFilter): Promise<LogEntry[]> {
    // Prefer internal (eventStore) for queries
    if (this.internalAdapter) {
      return this.internalAdapter.query(filter)
    }
    
    // Fall back to external
    if (this.externalAdapter) {
      return this.externalAdapter.query(filter)
    }
    
    throw new Error('No adapter supports queries')
  }
  
  async close() {
    await Promise.all([
      this.internalAdapter?.close(),
      this.externalAdapter?.close()
    ])
  }
  
  private shouldLogInternal(entry: LogEntry): boolean {
    const minLevel = this.config.internal?.level || 'info'
    return this.levelGreaterOrEqual(entry.level, minLevel)
  }
  
  private shouldLogExternal(entry: LogEntry): boolean {
    const minLevel = this.config.external?.level || 'info'
    return this.levelGreaterOrEqual(entry.level, minLevel)
  }
  
  private levelGreaterOrEqual(level: string, minLevel: string): boolean {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 }
    return levels[level] >= levels[minLevel]
  }
  
  private createExternalAdapter(config: ExternalLoggerConfig): LoggerAdapter {
    switch (config.adapter) {
      case 'console': return new ConsoleLoggerAdapter(config.options)
      case 'pino': return new PinoLoggerAdapter(config.options)
      case 'datadog': return new DatadogLoggerAdapter(config.options)
      case 'elasticsearch': return new ElasticsearchLoggerAdapter(config.options)
      default: throw new Error(`Unknown logger adapter: ${config.adapter}`)
    }
  }
}
```

## 6. Configuration Examples

### Development (Internal Only)

```typescript
export default defineNuxtConfig({
  queue: {
    logger: {
      routing: 'internal',  // Default - logs to eventStore only
      internal: {
        level: 'debug'  // Verbose locally, logs in nq:flow:{runId}
      }
    }
  }
})
```

### Production (External Only)

```typescript
export default defineNuxtConfig({
  queue: {
    logger: {
      routing: 'external',
      external: {
        level: 'info',
        adapter: 'datadog',
        options: {
          apiKey: process.env.DD_API_KEY,
          service: 'nuxt-queue',
          tags: ['env:production']
        }
      }
    }
  }
})
```

### Production (Both - Full Observability)

```typescript
export default defineNuxtConfig({
  queue: {
    logger: {
      routing: 'both',
      
      // Internal: errors + warnings only (save eventStore space)
      internal: {
        level: 'warn',
        trim: { maxLen: 1000, approx: true }
      },
      
      // External: everything to Datadog
      external: {
        level: 'info',
        adapter: 'datadog',
        options: {
          apiKey: process.env.DD_API_KEY,
          service: 'nuxt-queue'
        }
      }
    }
  }
})
```

### Staging (Internal + Console)

```typescript
export default defineNuxtConfig({
  queue: {
    logger: {
      routing: 'both',
      internal: {
        level: 'info'
      },
      external: {
        level: 'debug',
        adapter: 'console',
        options: { pretty: true, colors: true }
      }
    }
  }
})
```

## 7. Logger Context Integration

### Automatic Context Injection (v0.8 Integration)

The logger automatically includes context from v0.8's event-based registry:

```typescript
// src/runtime/server/worker/context.ts

export function createWorkerContext(
  job: Job,
  provider: QueueProvider,
  worker: WorkerConfig
): WorkerContext {
  const config = useRuntimeConfig()
  const eventManager = getEventManager()
  
  // Create logger with auto-injected context from v0.8
  const logger = new LogRouter(config.queue.logger, eventManager)
  const contextLogger = logger.child({
    // Flow context
    flowName: worker.flow?.name,
    runId: job.data.runId,
    stepName: worker.flow?.step,
    
    // Instance context (from v0.8 event-based registry)
    instanceId: config.queue.instanceId,
    workerId: worker.id,
    queue: worker.queue.name,
    
    // Job context
    jobId: job.id,
    attemptNumber: job.attemptNumber
  })
  
  return {
    logger: contextLogger,
    flow: createFlowContext(job, provider),
    state: createStateContext(job),
    provider
  }
}
```

### Manual Context Override

Workers can add or override context:

```typescript
export default defineQueueWorker(async (job, ctx) => {
  // Add custom context for this operation
  const customLogger = ctx.logger.child({
    userId: job.data.userId,
    sessionId: job.data.sessionId,
    operation: 'train_model'
  })
  
  customLogger.info('User-specific operation started')
  
  // All logs from this logger include userId, sessionId, operation
  customLogger.info('Processing data')
  customLogger.info('Training complete', { accuracy: 0.95 })
})
```

## 8. Query Interface

### Query Internal Logs (EventStore)

```typescript
// API endpoint to query logs from eventStore
export default defineEventHandler(async (event) => {
  const logger = useLogger()
  const query = getQuery(event)
  
  // Query logs from eventStore (fast, local)
  const logs = await logger.query({
    flowName: query.flow,
    runId: query.runId,
    level: ['warn', 'error'],
    startTime: query.start,
    endTime: query.end,
    limit: 100
  })
  
  return logs
})
```

### Query Flow Run Logs

Get all logs for a specific flow run:

```typescript
// In flow monitoring UI
async function getFlowRunLogs(runId: string) {
  const logger = useLogger()
  
  // Gets logs from flow stream: nq:flow:{runId}
  return await logger.query({
    runId,
    types: ['log.info', 'log.warn', 'log.error'],  // Filter log events only
    limit: 1000
  })
}
```

### Query Distributed Flow Logs

Trace complete flow execution across instances:

```typescript
// Query logs from all instances that participated in flow
const logs = await logger.query({
  runId: 'abc-123',
  types: ['log.info', 'log.warn', 'log.error']
})

// Returns logs from all steps across instances:
// [
//   { instanceId: 'main-app-1', stepName: 'start', level: 'info', ... },
//   { instanceId: 'ml-worker-1', stepName: 'train', level: 'info', ... },
//   { instanceId: 'ml-worker-1', stepName: 'train', level: 'error', ... },
//   { instanceId: 'main-app-2', stepName: 'save', level: 'info', ... }
// ]
```

## 9. Integration with v0.8 Event-Based Registry

### Instance Identification

Logs automatically include `instanceId` from v0.8's event-based registry:

```typescript
// Logged automatically with v0.8 context
{
  level: 'info',
  message: 'Processing job',
  instanceId: 'ml-worker-1',  // From v0.8 registry
  workerId: 'train-worker',
  queue: 'ml-train',
  flowName: 'ml-pipeline',
  runId: 'abc-123',
  stepName: 'train'
}
```

### Flow Tracing Across Instances

Trace complete flow execution:

```typescript
// Query internal logs for entire flow run
const eventManager = getEventManager()
const logs = await eventManager.query({
  stream: `nq:flow:abc-123`,  // Single flow stream
  types: ['log.info', 'log.warn', 'log.error']  // Filter for logs
})

// Timeline of execution across instances (logs + events mixed):
// T0: main-app-1/start     → flow.step.started
// T0: main-app-1/start     → log.info "Flow started"
// T1: ml-worker-1/train    → flow.step.started
// T1: ml-worker-1/train    → log.info "Training started"
// T2: ml-worker-1/train    → log.debug "Epoch 1/10 complete"
// T2: ml-worker-1/train    → state.set {accuracy: 0.85}
// T3: ml-worker-1/train    → log.info "Training complete"
// T3: ml-worker-1/train    → flow.step.completed
// T4: main-app-2/save      → flow.step.started
// T4: main-app-2/save      → log.info "Model saved"
// T4: main-app-2/save      → flow.step.completed
```

### Health Monitoring with Logs

Correlate logs with instance heartbeats from v0.8:

```typescript
async function detectInstanceIssues() {
  const registryQuery = createEventBasedRegistryQuery(getEventManager())
  const logger = useLogger()
  
  // Get healthy instances from v0.8 registry
  const healthyInstances = await registryQuery.getHealthyInstances()
  
  // Find recent errors
  const recentErrors = await logger.query({
    level: 'error',
    startTime: new Date(Date.now() - 300000).toISOString()  // Last 5 min
  })
  
  // Detect instances with errors but still sending heartbeats
  const instancesWithErrors = new Set(recentErrors.map(log => log.instanceId))
  
  return Array.from(instancesWithErrors).filter(id => 
    healthyInstances.includes(id)
  )
}
```

### Log-Based Registry Events

Optionally emit log events to registry stream for unified querying:

```typescript
export default defineNuxtConfig({
  queue: {
    logger: {
      routing: 'internal',
      internal: {
        // Logs go to flow stream: nq:flow:{runId}
        level: 'info'
      }
    }
  }
})

// If you need to emit errors to registry for monitoring:
// (This is separate from logging, done explicitly in worker code)
export default defineQueueWorker(async (job, ctx) => {
  try {
    // ... work
  } catch (error) {
    ctx.logger.error('Training failed', { error })
    
    // Also emit to registry for centralized error monitoring
    await ctx.flow.emit('worker.error', {
      instanceId: ctx.instanceId,
      workerId: ctx.workerId,
      error: error.message
    }, { stream: 'nq:registry' })
    
    throw error
  }
})
```

## 10. Log Sampling and Filtering

### Sampling (Reduce Volume)

Sample debug logs in production:

```typescript
export default defineNuxtConfig({
  queue: {
    logger: {
      routing: 'both',
      internal: {
        level: 'warn',  // Only warnings+ internally
        sampling: {
          rate: 0.1,  // Sample 10% of info/debug
          alwaysLog: ['warn', 'error']
        }
      },
      external: {
        level: 'info',  // Full info+ externally
        sampling: {
          rate: 0.2  // Sample 20% for cost control
        }
      }
    }
  }
})
```

**Implementation:**

```typescript
export class SamplingLogger implements LoggerAdapter {
  constructor(
    private adapter: LoggerAdapter,
    private options: {
      rate: number
      alwaysLog?: LogEntry['level'][]
    }
  ) {}
  
  async log(entry: LogEntry) {
    // Always log certain levels
    if (this.options.alwaysLog?.includes(entry.level)) {
      return this.adapter.log(entry)
    }
    
    // Sample other logs
    if (Math.random() < this.options.rate) {
      return this.adapter.log(entry)
    }
  }
}
```

## 11. Benefits

### Flexible Routing
- **Internal Only**: Simple dev setup, logs in flow history
- **External Only**: Production monitoring without eventStore overhead
- **Both**: Complete observability with flow history + external dashboards

### Production Ready
- **Performance**: Async logging with batching
- **Cost Control**: Sampling, level filtering, separate internal/external levels
- **Storage Efficiency**: TTL-based cleanup with eventStore trim

### Deep v0.8 Integration
- **Auto-Context**: Instance, worker, queue info from v0.8 registry
- **Flow Tracing**: Complete execution timeline across distributed instances
- **Health Correlation**: Link logs with heartbeat events

### Developer Experience
- **Type-Safe**: Full TypeScript support
- **Queryable**: Fast queries via eventStore or external providers
- **Flexible**: Console for dev, eventStore + external for prod

## 12. Implementation Checklist

- [ ] Create logger adapter interface
- [ ] Implement EventStore adapter (internal logging)
- [ ] Implement log router with routing modes (internal/external/both)
- [ ] Implement console adapter
- [ ] Implement Pino adapter
- [ ] Implement Datadog adapter
- [ ] Implement Elasticsearch adapter
- [ ] Integrate with worker context (auto-inject v0.8 registry context)
- [ ] Add query interface
- [ ] Implement sampling/filtering
- [ ] Update configuration types
- [ ] Write adapter tests
- [ ] Write routing tests
- [ ] Add configuration examples for all modes

## 13. Migration from v0.7

v0.7 does not have logging features, so this is a fresh implementation in v0.9.

### Default Configuration (Zero Config)

```typescript
// Defaults to internal logging if not configured
export default defineNuxtConfig({
  modules: ['nuxt-queue']
  // That's it! Uses eventStore adapter by default
})
```

All logs automatically go to `nq:flow:{runId}` stream alongside flow events.

## 14. Summary

v0.9 logging provides production-ready observability with flexible routing:

- ✅ **Three-Tier Routing** - Internal (eventStore), external (providers), or both
- ✅ **Single Stream Pattern** - Logs stored in `nq:flow:{runId}` with flow events
- ✅ **EventStore Integration** - Logs as events, automatic cleanup via flow TTL
- ✅ **Adapter-Based** - Pluggable backends (Console, Pino, Datadog, ES)
- ✅ **v0.8 Integration** - Auto-context from event-based registry
- ✅ **Structured** - JSON output with automatic flow context
- ✅ **Queryable** - Fast queries via eventStore or external systems
- ✅ **Cost Optimized** - Sampling, level filtering, separate routing

**Routing Strategy Recommendation:**

| Environment | Mode | Internal Level | External Level | Rationale |
|-------------|------|----------------|----------------|-----------|
| **Dev** | `internal` | `debug` | - | Simple, no external dependencies |
| **Staging** | `both` | `info` | `debug` | Test external integration |
| **Production** | `both` | `warn` | `info` | Flow errors in eventStore, full logs externally |
| **High-Traffic** | `external` | - | `info` (sampled) | Reduce eventStore load |

The design complements v0.8's event-based architecture by providing detailed operational visibility with flexible storage options. Logs are stored as events in the same stream as flow execution events, creating a unified timeline that includes both system events and application logs.

