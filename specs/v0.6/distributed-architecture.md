# Distributed Architecture & Flow Completion

> **Version**: v0.6.0  
> **Status**: 📋 Planning  
> **Last Updated**: 2025-11-04

## Overview

v0.6.0 introduces a distributed architecture that enables horizontal scaling and microservices-style deployment patterns. This includes:

1. **Distributed Flow Completion Tracking** - Shared state for flow lifecycle across instances
2. **Registry Aggregation System** - Distributed registry for multi-container deployments
3. **Worker Discovery & Health Monitoring** - Automatic instance registration and health checks
4. **Cross-Container Flow Execution** - Seamless event routing across isolated containers

## Architecture Patterns

### Pattern 1: Horizontal Scaling (Same Workers)

Multiple identical instances for high availability and load distribution:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Instance 1     │     │  Instance 2     │     │  Instance 3     │
│  ┌───────────┐  │     │  ┌───────────┐  │     │  ┌───────────┐  │
│  │ All       │  │     │  │ All       │  │     │  │ All       │  │
│  │ Workers   │  │     │  │ Workers   │  │     │  │ Workers   │  │
│  └───────────┘  │     │  └───────────┘  │     │  └───────────┘  │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         └───────────────────────┴───────────────────────┘
                                 │
                        Shared Redis/Postgres
```

**Use Cases**:
- High availability
- Load distribution
- Handle traffic spikes

### Pattern 2: Microservices (Specialized Workers)

Isolated containers for different worker types:

```
┌─────────────────────┐
│  Main App           │
│  ┌───────────────┐  │
│  │ Nuxt App      │  │
│  │ API Workers   │  │
│  └───────────────┘  │
└──────────┬──────────┘
           │
    Shared Redis/Postgres
           │
┌──────────┴──────────┬─────────────────────┬─────────────────────┐
│                     │                     │                     │
│  ┌───────────────┐  │  ┌───────────────┐  │  ┌───────────────┐  │
│  │ Python ML     │  │  │ GPU Worker    │  │  │ Email Worker  │  │
│  │ (TensorFlow)  │  │  │ (PyTorch)     │  │  │ (Node.js)     │  │
│  └───────────────┘  │  └───────────────┘  │  └───────────────┘  │
│  Container 2        │  Container 3        │  Container 4        │
└─────────────────────┘  └─────────────────┘  └─────────────────┘
```

**Use Cases**:
- Heavy dependencies isolation (ML frameworks)
- Language separation (Python vs Node.js)
- Resource requirements (GPU workers)
- Security isolation
- Independent scaling

## 1. Distributed Flow Completion Tracking

### Problem Statement

In v0.4, flow completion detection is not implemented because:
- In-memory tracking doesn't work across multiple instances
- Different steps may be processed by different containers
- No way to know when all terminal steps have completed

This blocks the `on-complete` cleanup strategy for state management.

### Solution: Shared Flow Run Tracking

Store flow execution state in Redis/Postgres so all instances can coordinate:

```typescript
interface FlowRunTracking {
  flowName: string
  runId: string
  startedAt: string
  terminalSteps: string[]      // Steps with no emits (from flow analyzer)
  completedSteps: string[]     // Steps that finished
  failedSteps: string[]        // Steps that failed
  status: 'running' | 'completed' | 'failed'
}
```

### Implementation

#### Storage Schema (Redis)

```typescript
// Flow run tracking
redis.hset(`nq:flow:run:${runId}`, {
  flowName: 'ml-pipeline',
  runId: 'run-123',
  startedAt: '2025-11-04T10:00:00Z',
  terminalSteps: JSON.stringify(['save-model', 'send-notification']),
  completedSteps: JSON.stringify(['preprocess']),
  failedSteps: JSON.stringify([]),
  status: 'running'
})

// TTL for cleanup (24 hours)
redis.expire(`nq:flow:run:${runId}`, 86400)
```

#### Storage Schema (Postgres)

```sql
CREATE TABLE flow_runs (
  run_id VARCHAR(255) PRIMARY KEY,
  flow_name VARCHAR(255) NOT NULL,
  started_at TIMESTAMP NOT NULL,
  terminal_steps JSONB NOT NULL,
  completed_steps JSONB NOT NULL DEFAULT '[]',
  failed_steps JSONB NOT NULL DEFAULT '[]',
  status VARCHAR(50) NOT NULL DEFAULT 'running',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_flow_runs_status ON flow_runs(status);
CREATE INDEX idx_flow_runs_flow_name ON flow_runs(flow_name);
```

#### Lifecycle Hooks

```typescript
// In flow-lifecycle.ts plugin

export default defineNitroPlugin((nitro) => {
  const provider = getQueueProvider()
  const eventManager = getEventManager()
  const registry = useRegistry()
  
  // 1. Initialize tracking on flow start
  eventManager.on('flow.start', async (event) => {
    const { flowName, runId } = event.data
    
    // Get terminal steps from flow analyzer
    const flowDef = registry.flows[flowName]
    const terminalSteps = Object.entries(flowDef.steps)
      .filter(([_, step]) => !step.emits || step.emits.length === 0)
      .map(([stepName]) => stepName)
    
    // Initialize tracking in shared storage
    await flowTracker.initialize(runId, {
      flowName,
      terminalSteps,
      startedAt: new Date().toISOString(),
      status: 'running'
    })
  })
  
  // 2. Track step completion
  eventManager.on('step.completed', async (event) => {
    const { flowName, runId, stepName } = event.data
    
    // Add to completed steps (atomic operation)
    await flowTracker.markStepCompleted(runId, stepName)
    
    // Check if all terminal steps are done
    const tracking = await flowTracker.get(runId)
    const allTerminalsDone = tracking.terminalSteps.every(
      step => tracking.completedSteps.includes(step)
    )
    
    if (allTerminalsDone) {
      // Emit flow completion event
      await eventManager.emit('flow.completed', {
        flowName,
        runId,
        completedAt: new Date().toISOString(),
        duration: Date.now() - new Date(tracking.startedAt).getTime()
      })
      
      // Update status
      await flowTracker.updateStatus(runId, 'completed')
      
      // Trigger cleanup if strategy is 'on-complete'
      const config = useRuntimeConfig()
      if (config.queue.state.cleanup?.strategy === 'on-complete') {
        await cleanupFlowState(runId)
      }
    }
  })
  
  // 3. Track step failures
  eventManager.on('step.failed', async (event) => {
    const { runId, stepName } = event.data
    
    await flowTracker.markStepFailed(runId, stepName)
    await flowTracker.updateStatus(runId, 'failed')
    
    // Emit flow failure event
    await eventManager.emit('flow.failed', {
      flowName: event.data.flowName,
      runId,
      failedStep: stepName,
      error: event.data.error
    })
  })
})
```

#### Flow Tracker Service

```typescript
// src/runtime/server/utils/flowTracker.ts

export interface FlowTracker {
  initialize(runId: string, data: {
    flowName: string
    terminalSteps: string[]
    startedAt: string
    status: 'running'
  }): Promise<void>
  
  get(runId: string): Promise<FlowRunTracking | null>
  
  markStepCompleted(runId: string, stepName: string): Promise<void>
  
  markStepFailed(runId: string, stepName: string): Promise<void>
  
  updateStatus(runId: string, status: 'running' | 'completed' | 'failed'): Promise<void>
  
  cleanup(runId: string): Promise<void>
}

// Redis implementation
export function createRedisFlowTracker(redis: Redis): FlowTracker {
  return {
    async initialize(runId, data) {
      await redis.hset(`nq:flow:run:${runId}`, {
        flowName: data.flowName,
        runId,
        startedAt: data.startedAt,
        terminalSteps: JSON.stringify(data.terminalSteps),
        completedSteps: JSON.stringify([]),
        failedSteps: JSON.stringify([]),
        status: data.status
      })
      await redis.expire(`nq:flow:run:${runId}`, 86400)
    },
    
    async get(runId) {
      const data = await redis.hgetall(`nq:flow:run:${runId}`)
      if (!data || !data.flowName) return null
      
      return {
        flowName: data.flowName,
        runId: data.runId,
        startedAt: data.startedAt,
        terminalSteps: JSON.parse(data.terminalSteps),
        completedSteps: JSON.parse(data.completedSteps),
        failedSteps: JSON.parse(data.failedSteps),
        status: data.status as any
      }
    },
    
    async markStepCompleted(runId, stepName) {
      const tracking = await this.get(runId)
      if (!tracking) return
      
      if (!tracking.completedSteps.includes(stepName)) {
        tracking.completedSteps.push(stepName)
        await redis.hset(`nq:flow:run:${runId}`, 
          'completedSteps', 
          JSON.stringify(tracking.completedSteps)
        )
      }
    },
    
    async markStepFailed(runId, stepName) {
      const tracking = await this.get(runId)
      if (!tracking) return
      
      if (!tracking.failedSteps.includes(stepName)) {
        tracking.failedSteps.push(stepName)
        await redis.hset(`nq:flow:run:${runId}`, 
          'failedSteps', 
          JSON.stringify(tracking.failedSteps)
        )
      }
    },
    
    async updateStatus(runId, status) {
      await redis.hset(`nq:flow:run:${runId}`, 'status', status)
    },
    
    async cleanup(runId) {
      await redis.del(`nq:flow:run:${runId}`)
    }
  }
}

// Postgres implementation
export function createPostgresFlowTracker(db: Database): FlowTracker {
  return {
    async initialize(runId, data) {
      await db.query(
        `INSERT INTO flow_runs (run_id, flow_name, started_at, terminal_steps, status)
         VALUES ($1, $2, $3, $4, $5)`,
        [runId, data.flowName, data.startedAt, JSON.stringify(data.terminalSteps), data.status]
      )
    },
    
    async get(runId) {
      const result = await db.query(
        `SELECT * FROM flow_runs WHERE run_id = $1`,
        [runId]
      )
      if (result.rows.length === 0) return null
      
      const row = result.rows[0]
      return {
        flowName: row.flow_name,
        runId: row.run_id,
        startedAt: row.started_at,
        terminalSteps: row.terminal_steps,
        completedSteps: row.completed_steps,
        failedSteps: row.failed_steps,
        status: row.status
      }
    },
    
    async markStepCompleted(runId, stepName) {
      await db.query(
        `UPDATE flow_runs 
         SET completed_steps = jsonb_insert(completed_steps, '{-1}', $2::jsonb),
             updated_at = NOW()
         WHERE run_id = $1 
         AND NOT (completed_steps ? $3)`,
        [runId, JSON.stringify(stepName), stepName]
      )
    },
    
    async markStepFailed(runId, stepName) {
      await db.query(
        `UPDATE flow_runs 
         SET failed_steps = jsonb_insert(failed_steps, '{-1}', $2::jsonb),
             updated_at = NOW()
         WHERE run_id = $1 
         AND NOT (failed_steps ? $3)`,
        [runId, JSON.stringify(stepName), stepName]
      )
    },
    
    async updateStatus(runId, status) {
      await db.query(
        `UPDATE flow_runs SET status = $2, updated_at = NOW() WHERE run_id = $1`,
        [runId, status]
      )
    },
    
    async cleanup(runId) {
      await db.query(`DELETE FROM flow_runs WHERE run_id = $1`, [runId])
    }
  }
}
```

### Benefits

- ✅ Works across multiple instances (horizontal scaling)
- ✅ Enables `on-complete` cleanup strategy
- ✅ Accurate flow lifecycle events
- ✅ Persistent tracking survives restarts
- ✅ Uses existing flow analyzer infrastructure
- ✅ Atomic operations prevent race conditions

## 2. Distributed Registry System

### Problem Statement

When deploying workers in separate containers:
1. Each container only has its own worker files
2. Flow definitions are split across containers
3. No way to compile complete registry
4. Event routing breaks (can't find next step's queue)

### Solution: Registry Aggregation

Introduce a shared registry service that:
- Aggregates partial registries from all instances
- Maintains complete flow definitions
- Tracks which instance handles which queue
- Monitors instance health

### Architecture

```typescript
interface PartialRegistry {
  instanceId: string
  version: number
  compiledAt: string
  workers: WorkerEntry[]
  flows: Partial<FlowsIndex>
  queues: string[]                    // Queues this instance handles
  externalQueues?: string[]           // Queues this instance references but doesn't handle
}

interface AggregatedRegistry {
  version: number
  aggregatedAt: string
  instances: Record<string, InstanceInfo>
  flows: FlowsIndex                   // Complete flow definitions
  queueMap: Record<string, string[]>  // queue -> [instanceIds] mapping
}

interface InstanceInfo {
  instanceId: string
  status: 'healthy' | 'unhealthy' | 'dead'
  lastHeartbeat: string
  workers: WorkerEntry[]
  queues: string[]
}
```

### Implementation

#### Registry Aggregator Service

```typescript
// src/runtime/server/utils/registryAggregator.ts

export interface RegistryAggregator {
  // Instance registration
  register(instanceId: string, registry: PartialRegistry): Promise<void>
  unregister(instanceId: string): Promise<void>
  
  // Heartbeat
  heartbeat(instanceId: string): Promise<void>
  
  // Query
  getFlow(flowName: string): Promise<FlowDefinition | null>
  getQueueHandlers(queueName: string): Promise<string[]>
  getInstance(instanceId: string): Promise<InstanceInfo | null>
  getAllInstances(): Promise<InstanceInfo[]>
  getAggregatedRegistry(): Promise<AggregatedRegistry>
  
  // Health
  isInstanceHealthy(instanceId: string): Promise<boolean>
  markInstanceDead(instanceId: string): Promise<void>
}
```

#### Redis Storage

```typescript
export function createRedisRegistryAggregator(redis: Redis): RegistryAggregator {
  const HEARTBEAT_TIMEOUT = 30 // seconds
  const HEARTBEAT_KEY = (id: string) => `nq:registry:heartbeat:${id}`
  const INSTANCE_KEY = (id: string) => `nq:registry:instance:${id}`
  const FLOW_KEY = (name: string) => `nq:registry:flow:${name}`
  const QUEUE_MAP_KEY = (queue: string) => `nq:registry:queue-map:${queue}`
  
  return {
    async register(instanceId, registry) {
      // Store instance registry
      await redis.set(INSTANCE_KEY(instanceId), JSON.stringify({
        instanceId,
        workers: registry.workers,
        queues: registry.queues,
        compiledAt: registry.compiledAt,
        status: 'healthy'
      }))
      
      // Update queue mappings
      for (const queue of registry.queues) {
        await redis.sadd(QUEUE_MAP_KEY(queue), instanceId)
      }
      
      // Aggregate flow definitions
      for (const [flowName, flowDef] of Object.entries(registry.flows)) {
        const existingFlow = await redis.get(FLOW_KEY(flowName))
        const existing = existingFlow ? JSON.parse(existingFlow) : { steps: {} }
        
        // Merge flow definitions
        const merged = {
          entry: flowDef.entry || existing.entry,
          steps: { ...existing.steps, ...flowDef.steps }
        }
        
        await redis.set(FLOW_KEY(flowName), JSON.stringify(merged))
      }
      
      // Set initial heartbeat
      await this.heartbeat(instanceId)
    },
    
    async unregister(instanceId) {
      const instanceData = await redis.get(INSTANCE_KEY(instanceId))
      if (!instanceData) return
      
      const instance = JSON.parse(instanceData)
      
      // Remove from queue mappings
      for (const queue of instance.queues) {
        await redis.srem(QUEUE_MAP_KEY(queue), instanceId)
      }
      
      // Remove instance data
      await redis.del(INSTANCE_KEY(instanceId))
      await redis.del(HEARTBEAT_KEY(instanceId))
    },
    
    async heartbeat(instanceId) {
      await redis.setex(
        HEARTBEAT_KEY(instanceId),
        HEARTBEAT_TIMEOUT,
        Date.now().toString()
      )
    },
    
    async getFlow(flowName) {
      const data = await redis.get(FLOW_KEY(flowName))
      return data ? JSON.parse(data) : null
    },
    
    async getQueueHandlers(queueName) {
      const handlers = await redis.smembers(QUEUE_MAP_KEY(queueName))
      
      // Filter out dead instances
      const healthy = []
      for (const instanceId of handlers) {
        if (await this.isInstanceHealthy(instanceId)) {
          healthy.push(instanceId)
        }
      }
      
      return healthy
    },
    
    async getInstance(instanceId) {
      const data = await redis.get(INSTANCE_KEY(instanceId))
      if (!data) return null
      
      const instance = JSON.parse(data)
      const isHealthy = await this.isInstanceHealthy(instanceId)
      
      return {
        ...instance,
        status: isHealthy ? 'healthy' : 'unhealthy'
      }
    },
    
    async getAllInstances() {
      const keys = await redis.keys('nq:registry:instance:*')
      const instances = []
      
      for (const key of keys) {
        const instanceId = key.replace('nq:registry:instance:', '')
        const instance = await this.getInstance(instanceId)
        if (instance) instances.push(instance)
      }
      
      return instances
    },
    
    async getAggregatedRegistry() {
      const instances = await this.getAllInstances()
      const flows: any = {}
      const queueMap: any = {}
      
      // Get all flows
      const flowKeys = await redis.keys('nq:registry:flow:*')
      for (const key of flowKeys) {
        const flowName = key.replace('nq:registry:flow:', '')
        flows[flowName] = await this.getFlow(flowName)
      }
      
      // Build queue map
      const queueKeys = await redis.keys('nq:registry:queue-map:*')
      for (const key of queueKeys) {
        const queueName = key.replace('nq:registry:queue-map:', '')
        queueMap[queueName] = await this.getQueueHandlers(queueName)
      }
      
      return {
        version: 1,
        aggregatedAt: new Date().toISOString(),
        instances: Object.fromEntries(instances.map(i => [i.instanceId, i])),
        flows,
        queueMap
      }
    },
    
    async isInstanceHealthy(instanceId) {
      const exists = await redis.exists(HEARTBEAT_KEY(instanceId))
      return exists === 1
    },
    
    async markInstanceDead(instanceId) {
      await this.unregister(instanceId)
    }
  }
}
```

#### Module Integration

```typescript
// In module.ts

export default defineNuxtModule({
  async setup(options, nuxt) {
    // ... existing setup ...
    
    // Register with aggregator if distributed mode enabled
    if (options.distributed?.enabled) {
      const instanceId = options.distributed.instanceId || hostname()
      
      nuxt.hook('ready', async () => {
        const aggregator = await getRegistryAggregator()
        
        // Register this instance
        await aggregator.register(instanceId, {
          instanceId,
          version: 1,
          compiledAt: compiledRegistry.compiledAt,
          workers: compiledRegistry.workers,
          flows: compiledRegistry.flows,
          queues: [...new Set(compiledRegistry.workers.map(w => w.queue.name))]
        })
        
        console.log(`[nuxt-queue] Registered instance: ${instanceId}`)
      })
    }
  }
})
```

#### Runtime Plugin (Heartbeat)

```typescript
// src/runtime/server/plugins/registry-heartbeat.ts

export default defineNitroPlugin((nitro) => {
  const config = useRuntimeConfig()
  
  if (!config.queue.distributed?.enabled) return
  
  const instanceId = config.queue.distributed.instanceId
  const interval = config.queue.distributed.heartbeatInterval || 10000
  
  const aggregator = getRegistryAggregator()
  
  // Send heartbeat
  const heartbeatInterval = setInterval(async () => {
    try {
      await aggregator.heartbeat(instanceId)
    } catch (error) {
      console.error('[nuxt-queue] Heartbeat failed:', error)
    }
  }, interval)
  
  // Cleanup on shutdown
  nitro.hooks.hook('close', async () => {
    clearInterval(heartbeatInterval)
    await aggregator.unregister(instanceId)
    console.log(`[nuxt-queue] Unregistered instance: ${instanceId}`)
  })
})
```

### Cross-Container Flow Execution

Update the flow engine to use the aggregated registry:

```typescript
// In useFlowEngine.ts

export async function handleTrigger(eventName: string, data: any, ctx: WorkerContext) {
  const aggregator = getRegistryAggregator()
  const { flowName, runId } = ctx
  
  // Get complete flow definition from aggregator
  const flow = await aggregator.getFlow(flowName)
  if (!flow) {
    throw new Error(`Flow ${flowName} not found in aggregated registry`)
  }
  
  // Find steps that subscribe to this event
  const nextSteps = Object.entries(flow.steps)
    .filter(([_, step]) => step.subscribes?.includes(eventName))
  
  for (const [stepName, stepDef] of nextSteps) {
    // Find which instances handle this queue
    const handlers = await aggregator.getQueueHandlers(stepDef.queue)
    
    if (handlers.length === 0) {
      console.error(`[nuxt-queue] No healthy instances for queue: ${stepDef.queue}`)
      continue
    }
    
    // Enqueue job (provider will handle it via shared Redis/Postgres)
    await ctx.provider.enqueue(stepDef.queue, {
      name: stepName,
      data: {
        runId,
        flowName,
        ...data
      }
    })
    
    console.log(`[nuxt-queue] Triggered ${stepName} on queue ${stepDef.queue}`)
  }
}
```

## 3. Configuration

### Distributed Mode Config

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['nuxt-queue'],
  
  queue: {
    // Enable distributed mode
    distributed: {
      enabled: true,
      instanceId: process.env.INSTANCE_ID || undefined,  // Auto-generate if not provided
      
      // Registry storage (must be shared)
      registryStore: {
        adapter: 'redis',  // or 'postgres'
        redis: {
          host: process.env.REDIS_HOST || '127.0.0.1',
          port: parseInt(process.env.REDIS_PORT || '6379')
        }
      },
      
      // Heartbeat settings
      heartbeatInterval: 10000,  // 10 seconds
      heartbeatTimeout: 30,      // Mark dead after 30s without heartbeat
      
      // Health checks
      healthCheck: {
        enabled: true,
        interval: 15000,           // Check health every 15s
        failureThreshold: 3        // Mark dead after 3 failures
      }
    },
    
    // Queue backend (must be shared)
    store: {
      adapter: 'redis',
      redis: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT || '6379')
      }
    }
  }
})
```

### Docker Compose Example

```yaml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
  
  # Main Nuxt app with API workers
  main-app:
    build: .
    environment:
      INSTANCE_ID: main-app
      REDIS_HOST: redis
      REDIS_PORT: 6379
      NODE_ENV: production
    ports:
      - "3000:3000"
    depends_on:
      - redis
    deploy:
      replicas: 2  # Horizontal scaling
  
  # Python ML worker (isolated)
  ml-worker:
    build: ./ml-worker
    environment:
      INSTANCE_ID: ml-worker
      REDIS_HOST: redis
      REDIS_PORT: 6379
    depends_on:
      - redis
    volumes:
      - ml-models:/models
    deploy:
      replicas: 1
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
  
  # Email worker (isolated)
  email-worker:
    build: ./email-worker
    environment:
      INSTANCE_ID: email-worker
      REDIS_HOST: redis
      REDIS_PORT: 6379
      SMTP_HOST: ${SMTP_HOST}
      SMTP_USER: ${SMTP_USER}
      SMTP_PASS: ${SMTP_PASS}
    depends_on:
      - redis
    deploy:
      replicas: 3  # Scale email sending

volumes:
  redis-data:
  ml-models:
```

## 4. Deployment Workflow

### Step 1: Define Distributed Flow

**Main App** (`server/queues/ml-flow-start.ts`):
```typescript
export const config = defineQueueConfig({
  queue: { name: 'api' },
  flow: {
    name: ['ml-pipeline'],
    role: 'entry',
    step: 'start',
    emits: ['data.ready']
  }
})

export default defineQueueWorker(async (job, ctx) => {
  // Preprocess data
  const processed = await preprocessData(job.data)
  
  // Trigger ML step (will route to ml-worker container)
  await ctx.flow.emit('data.ready', { data: processed })
  
  return { ok: true }
})
```

**ML Worker Container** (`ml_worker/queues/train.py`):
```python
from nuxt_queue import define_queue_config, define_queue_worker

config = define_queue_config({
    'queue': { 'name': 'ml-train' },
    'flow': {
        'name': ['ml-pipeline'],
        'role': 'step',
        'step': 'train',
        'subscribes': ['data.ready'],
        'emits': ['model.trained']
    }
})

@define_queue_worker
async def worker(job, ctx):
    # Train model
    model = train_model(job['data'])
    
    # Trigger next step
    await ctx.flow.emit('model.trained', { 'model_id': model.id })
    
    return { 'ok': True }
```

**Main App** (`server/queues/ml-flow-save.ts`):
```typescript
export const config = defineQueueConfig({
  queue: { name: 'api' },
  flow: {
    name: ['ml-pipeline'],
    role: 'step',
    step: 'save',
    subscribes: ['model.trained']
  }
})

export default defineQueueWorker(async (job, ctx) => {
  // Save to database
  await saveModel(job.data.model_id)
  
  // Terminal step - triggers flow completion
  return { ok: true }
})
```

### Step 2: Build Containers

Each container builds only its workers:

```dockerfile
# Main app Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
CMD ["node", ".output/server/index.mjs"]
```

```dockerfile
# ML worker Dockerfile
FROM python:3.11
WORKDIR /app
RUN pip install torch tensorflow nuxt-queue
COPY ml_worker/ ./
CMD ["python", "worker.py"]
```

### Step 3: Deploy

```bash
docker-compose up -d
```

Each container on startup:
1. Compiles its partial registry
2. Registers with aggregator
3. Starts heartbeat
4. Begins processing its queues

### Step 4: Monitor

```typescript
// API endpoint to check distributed status
export default defineEventHandler(async () => {
  const aggregator = getRegistryAggregator()
  const registry = await aggregator.getAggregatedRegistry()
  
  return {
    instances: Object.values(registry.instances).map(i => ({
      id: i.instanceId,
      status: i.status,
      queues: i.queues,
      workers: i.workers.length
    })),
    flows: Object.keys(registry.flows),
    queueMap: registry.queueMap
  }
})
```

## 5. Advanced Features

### Instance Affinity

Pin flow runs to specific instances for state locality:

```typescript
// Worker can request affinity
export default defineQueueWorker(async (job, ctx) => {
  // Load model into GPU memory
  const model = await loadModel()
  
  // Emit with affinity - next steps stay on this instance
  await ctx.flow.emit('model.loaded', { model_id: model.id }, {
    affinity: { instanceId: ctx.instanceId }
  })
})
```

### Circuit Breaking

Automatically handle failed instances:

```typescript
// In flow engine
async function enqueueWithCircuitBreaker(queue: string, job: any) {
  const aggregator = getRegistryAggregator()
  const handlers = await aggregator.getQueueHandlers(queue)
  
  if (handlers.length === 0) {
    // No healthy instances - queue for retry
    await deadLetterQueue.add(queue, job, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 }
    })
    throw new Error(`No healthy instances for queue: ${queue}`)
  }
  
  // Proceed normally
  await provider.enqueue(queue, job)
}
```

### Load-Based Routing

Route to least-loaded instance:

```typescript
interface LoadBalancer {
  selectInstance(instances: string[]): Promise<string>
}

class LeastLoadedBalancer implements LoadBalancer {
  async selectInstance(instances: string[]) {
    const loads = await Promise.all(
      instances.map(async id => ({
        id,
        load: await getInstanceLoad(id)  // Queue depth, CPU, etc.
      }))
    )
    
    loads.sort((a, b) => a.load - b.load)
    return loads[0].id
  }
}
```

### Health Monitoring

Background job to check instance health:

```typescript
// In health-check plugin
export default defineNitroPlugin((nitro) => {
  const config = useRuntimeConfig()
  if (!config.queue.distributed?.healthCheck?.enabled) return
  
  const aggregator = getRegistryAggregator()
  const interval = config.queue.distributed.healthCheck.interval || 15000
  
  setInterval(async () => {
    const instances = await aggregator.getAllInstances()
    
    for (const instance of instances) {
      const isHealthy = await aggregator.isInstanceHealthy(instance.instanceId)
      
      if (!isHealthy && instance.status !== 'dead') {
        console.warn(`[nuxt-queue] Instance unhealthy: ${instance.instanceId}`)
        await aggregator.markInstanceDead(instance.instanceId)
      }
    }
  }, interval)
})
```

## 6. Benefits Summary

### Distributed Flow Completion
- ✅ Accurate flow lifecycle across instances
- ✅ Enables `on-complete` cleanup strategy
- ✅ Atomic operations prevent race conditions
- ✅ Persistent tracking survives restarts

### Registry Aggregation
- ✅ True microservices architecture
- ✅ Language-agnostic workers (Python, Node.js, Go, etc.)
- ✅ Independent scaling per worker type
- ✅ Resource isolation (GPU, memory, CPU)
- ✅ Simplified dependencies (each container minimal)
- ✅ Zero-downtime deployments
- ✅ Automatic discovery and health monitoring

### Operational Benefits
- ✅ High availability through redundancy
- ✅ Fault tolerance with circuit breaking
- ✅ Horizontal scaling for performance
- ✅ Vertical scaling for specific workers
- ✅ Cost optimization (scale only what's needed)
- ✅ Security isolation for sensitive operations

## 7. Migration Path

### v0.6.0: Foundation
- Implement distributed flow completion tracking
- Add registry aggregator service
- Enable distributed mode flag

### v0.6.1: Registration
- Implement instance registration
- Add heartbeat mechanism
- Basic health checks

### v0.6.2: Execution
- Cross-container flow execution
- Event routing via aggregator
- Queue mapping

### v0.6.3: Reliability
- Circuit breaking
- Dead letter queues
- Retry strategies

### v0.7.0: Advanced
- Instance affinity
- Load-based routing
- Auto-scaling hooks
- Metrics and observability

## 8. Testing Strategy

### Unit Tests
- Flow tracker operations (initialize, mark completed, check terminal)
- Registry aggregator (register, merge, query)
- Heartbeat mechanism

### Integration Tests
- Multi-instance flow completion
- Cross-container event routing
- Instance failure recovery
- Registry aggregation accuracy

### E2E Tests
- Deploy multi-container setup
- Run distributed flows
- Simulate instance failures
- Verify cleanup strategies

### Load Tests
- Horizontal scaling performance
- Registry aggregation under load
- Heartbeat reliability
- Event routing latency
