# Distributed Architecture & Flow Completion

> **Version**: v0.8.0  
> **Status**: 📋 Planning  
> **Last Updated**: 2025-11-05

## Overview

v0.8.0 introduces an **event-based registry architecture** that is always active. Building on the v0.5 event system, all instances automatically emit their workers to the eventStore, creating a unified, distributed-ready registry.

**Key Features**:

1. **Event-Based Registry** - Always active, step-based registry stored in eventStore
2. **Worker & Step Versioning** - Support rolling deployments and version-aware routing
3. **Cross-Container Flow Execution** - Event-based routing without hardcoded registry aggregation

**Design Principles**:

- ✅ **Always Event-Based** - No local-only mode. Every instance emits to eventStore.
- ✅ **Works Single or Multi-Instance** - Same code path for dev and production.
- ✅ **Simple Configuration** - Just configure eventStore (already required for v0.5 triggers).
- ✅ **Zero Infrastructure** - Use memory adapter for local dev, Redis/Postgres for production.

**State Cleanup**: Uses TTL-based or developer-managed cleanup strategies (no complex lifecycle tracking needed).

## Architecture Patterns

### Event-Driven Registry (v0.5 Pattern)

Instead of a separate registry aggregation service, we use the existing event system:

```
┌─────────────────────────────────────────────────────────────┐
│                      Event Store                            │
│  ┌──────────────────────────────────────────────────────┐  │
  │  │ Registry Events (nq:registry stream)                 │  │
  │  │  - flow.step.registered                              │  │
  │  │  - worker.registered                                 │  │
  │  │  - instance.heartbeat                                │  │
  │  │  - Version-aware step registration                   │  │
  │  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         │                    │                    │
    ┌────▼─────┐         ┌────▼─────┐        ┌────▼─────┐
    │Instance 1│         │Instance 2│        │Instance 3│
    │All Workers│        │ML Workers│        │API Workers│
    └──────────┘         └──────────┘        └──────────┘
```

**Benefits over v0.6 approach**:
- ✅ Reuses existing event infrastructure (v0.5)
- ✅ No separate Redis keys/aggregation logic
- ✅ Automatic persistence and history
- ✅ Event stream provides audit trail
- ✅ Simpler implementation

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

## 1. Central Flow Registry (Event-Based)

### Problem Statement

In distributed deployments:
- Each container only knows about its own workers
- Flow definitions split across containers
- Need to discover which container handles which queue
- Traditional approach: complex registry aggregation service

### Solution: Event-Driven Registry

Use the v0.5 event system pattern - emit registry events to eventStore:

```typescript
// Registry event types
type RegistryEvent =
  | { type: 'flow.step.registered', data: FlowStepRegistration }
  | { type: 'worker.registered', data: WorkerRegistration }
  | { type: 'instance.heartbeat', data: InstanceHeartbeat }
  | { type: 'instance.shutdown', data: { instanceId: string } }

interface FlowStepRegistration {
  flowName: string
  instanceId: string
  stepName: string
  queue: string
  workerId: string
  role: 'entry' | 'step'
  subscribes: string[]
  emits: string[]
  timestamp: string
}

interface WorkerRegistration {
  instanceId: string
  workerId: string
  queue: string
  timestamp: string
}

interface InstanceHeartbeat {
  instanceId: string
  queues: string[]
  workerCount: number
  timestamp: string
}
```

### Implementation

#### Registry Emission Plugin (Runtime)

```typescript
// src/runtime/server/plugins/registry-emission.ts

export default defineNitroPlugin(async (nitro) => {
  const config = useRuntimeConfig()
  const registry = useRegistry()
  const eventManager = getEventManager()
  
  // Auto-generate instanceId if not provided
  const instanceId = config.queue.instanceId || hostname()
  
  console.log(`[nuxt-queue] Registering instance: ${instanceId}`)
  
  // Emit individual step registrations for each flow worker
  // The registry query will build complete flows from these step events
  for (const worker of registry.workers) {
    if (!worker.flow) continue  // Skip non-flow workers
    
    // Emit step registration for each flow this worker belongs to
    for (const flowName of worker.flow.names) {
      await eventManager.emit('flow.step.registered', {
        flowName,
        instanceId,
        stepName: worker.flow.step,
        queue: worker.queue.name,
        workerId: worker.id,
        role: worker.flow.role,  // 'entry' or 'step'
        subscribes: worker.flow.subscribes || [],
        emits: worker.flow.emits || [],
        timestamp: new Date().toISOString()
      })
    }
  }
  
  // Also emit standard worker registrations for non-flow workers
  const nonFlowWorkers = registry.workers.filter(w => !w.flow)
  for (const worker of nonFlowWorkers) {
    await eventManager.emit('worker.registered', {
      instanceId,
      workerId: worker.id,
      queue: worker.queue.name,
      timestamp: new Date().toISOString()
    })
  }
  
  console.log(
    `[nuxt-queue] Registered ${registry.workers.filter(w => w.flow).length} flow steps ` +
    `and ${nonFlowWorkers.length} standalone workers to event store`
  )
  
  // Emit shutdown event when server closes
  nitro.hooks.hook('close', async () => {
    console.log(`[nuxt-queue] Shutting down instance: ${instanceId}`)
    
    await eventManager.emit('instance.shutdown', {
      instanceId,
      timestamp: new Date().toISOString()
    })
  })
})
```


#### Heartbeat Plugin

```typescript
// src/runtime/server/plugins/registry-heartbeat.ts

export default defineNitroPlugin((nitro) => {
  const config = useRuntimeConfig()
  const eventManager = getEventManager()
  const registry = useRegistry()
  
  // Auto-generate instanceId if not provided
  const instanceId = config.queue.instanceId || hostname()
  const interval = config.queue.heartbeatInterval || 10000
  
  // Send heartbeat
  const heartbeatInterval = setInterval(async () => {
    try {
      await eventManager.emit('instance.heartbeat', {
        instanceId,
        queues: [...new Set(registry.workers.map(w => w.queue.name))],
        workerCount: registry.workers.length,
        timestamp: new Date().toISOString()
      })
    } catch (error) {
      console.error('[nuxt-queue] Heartbeat failed:', error)
    }
  }, interval)
  
  // Cleanup on shutdown
  nitro.hooks.hook('close', async () => {
    clearInterval(heartbeatInterval)
    await eventManager.emit('instance.shutdown', {
      instanceId,
      timestamp: new Date().toISOString()
    })
    console.log(`[nuxt-queue] Instance shutdown: ${instanceId}`)
  })
})
```

#### Query Registry from Events

```typescript
// src/runtime/server/utils/registryQuery.ts

export interface RegistryQuery {
  getFlow(flowName: string): Promise<FlowDefinition | null>
  getQueueHandlers(queueName: string): Promise<string[]>
  getHealthyInstances(): Promise<string[]>
  waitForFlowReady(flowName: string, timeout?: number): Promise<FlowDefinition | null>
}

export function createEventBasedRegistryQuery(
  eventManager: EventManager
): RegistryQuery {
  const REGISTRY_STREAM = 'nq:registry'
  const HEARTBEAT_TIMEOUT = 30000 // 30 seconds
  
  return {
    async getFlow(flowName) {
      // Read all flow step registration events
      const events = await eventManager.query({
        stream: REGISTRY_STREAM,
        types: ['flow.step.registered']
      })
      
      // Find steps for this flow
      const stepEvents = events.filter(e => 
        e.type === 'flow.step.registered' && e.data.flowName === flowName
      )
      
      if (stepEvents.length === 0) return null
      
      // Build flow definition from individual step events
      const merged: FlowDefinition = {
        entry: undefined,
        steps: {}
      }
      
      // Track which instances contribute to this flow
      const contributingInstances = new Set<string>()
      
      for (const event of stepEvents) {
        const stepData = event.data
        contributingInstances.add(stepData.instanceId)
        
        // If this step is the entry, set it
        if (stepData.role === 'entry') {
          merged.entry = {
            queue: stepData.queue,
            workerId: stepData.workerId,
            instanceId: stepData.instanceId
          }
        }
        
        // Add step to flow definition
        merged.steps[stepData.stepName] = {
          queue: stepData.queue,
          workerId: stepData.workerId,
          instanceId: stepData.instanceId,
          subscribes: stepData.subscribes,
          emits: stepData.emits
        }
      }
      
      // Check if all contributing instances are healthy
      const healthyInstances = await this.getHealthyInstances()
      const allHealthy = Array.from(contributingInstances).every(
        id => healthyInstances.includes(id)
      )
      
      if (!allHealthy) {
        console.warn(
          `[nuxt-queue] Flow ${flowName} has unhealthy instances. ` +
          `Contributing: ${Array.from(contributingInstances).join(', ')}. ` +
          `Healthy: ${healthyInstances.join(', ')}`
        )
      }
      
      // Attach metadata for validation
      ;(merged as any)._metadata = {
        instances: Array.from(contributingInstances),
        allHealthy,
        lastUpdated: new Date().toISOString()
      }
      
      return merged
    },
    
    async waitForFlowReady(flowName, timeout = 30000) {
      const startTime = Date.now()
      
      while (Date.now() - startTime < timeout) {
        const flow = await this.getFlow(flowName)
        
        if (flow && flow.entry && Object.keys(flow.steps).length > 0) {
          // Verify all instances are healthy
          if ((flow as any)._metadata?.allHealthy) {
            return flow
          }
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 500))
      }
      
      throw new Error(
        `[nuxt-queue] Timeout waiting for flow ${flowName} to be ready. ` +
        `Waited ${timeout}ms. Flow may be incomplete or instances unhealthy.`
      )
    },
    
    async getQueueHandlers(queueName) {
      // Get recent heartbeats
      const events = await eventManager.query({
        stream: REGISTRY_STREAM,
        types: ['instance.heartbeat'],
        since: new Date(Date.now() - HEARTBEAT_TIMEOUT * 2).toISOString()
      })
      
      // Find instances handling this queue
      const handlers = new Set<string>()
      const now = Date.now()
      
      for (const event of events) {
        const age = now - new Date(event.data.timestamp).getTime()
        if (age < HEARTBEAT_TIMEOUT && event.data.queues.includes(queueName)) {
          handlers.add(event.data.instanceId)
        }
      }
      
      return Array.from(handlers)
    },
    
    async getHealthyInstances() {
      const events = await eventManager.query({
        stream: REGISTRY_STREAM,
        types: ['instance.heartbeat'],
        since: new Date(Date.now() - HEARTBEAT_TIMEOUT * 2).toISOString()
      })
      
      const instances = new Map<string, number>()
      
      for (const event of events) {
        const timestamp = new Date(event.data.timestamp).getTime()
        instances.set(event.data.instanceId, timestamp)
      }
      
      // Filter healthy (recent heartbeat)
      const now = Date.now()
      return Array.from(instances.entries())
        .filter(([_, lastSeen]) => now - lastSeen < HEARTBEAT_TIMEOUT)
        .map(([id]) => id)
    }
  }
}
```

### Storage

All registry events go to `nq:registry` stream in eventStore:

```typescript
// Redis Streams example - Individual step registrations

// Instance 1: Entry step
XADD nq:registry * 
  type "flow.step.registered" 
  flowName "ml-pipeline"
  instanceId "main-app-1"
  stepName "start"
  queue "api"
  workerId "ml-pipeline-entry"
  role "entry"
  subscribes '[]'
  emits '["data.ready"]'
  timestamp "2025-11-05T10:00:00Z"

// Instance 2: Processing step
XADD nq:registry * 
  type "flow.step.registered" 
  flowName "ml-pipeline"
  instanceId "ml-worker-1"
  stepName "train"
  queue "ml-train"
  workerId "ml-train-worker"
  role "step"
  subscribes '["data.ready"]'
  emits '["model.trained"]'
  timestamp "2025-11-05T10:00:05Z"

// Instance 3: Terminal step
XADD nq:registry * 
  type "flow.step.registered" 
  flowName "ml-pipeline"
  instanceId "main-app-2"
  stepName "save"
  queue "api"
  workerId "ml-pipeline-save"
  role "step"
  subscribes '["model.trained"]'
  emits '[]'
  timestamp "2025-11-05T10:00:10Z"

// Heartbeat
XADD nq:registry * 
  type "instance.heartbeat" 
  instanceId "main-app-1"
  queues '["api"]'
  workerCount 2
  timestamp "2025-11-05T10:00:15Z"
```

### Benefits

- ✅ Reuses v0.5 event infrastructure
- ✅ No new storage mechanisms
- ✅ Automatic event history
- ✅ **Granular step-by-step registration** - No need for complete flow knowledge on instance
- ✅ **Works perfectly with partial instances** - Step-only instances just emit their steps
- ✅ Query by reading event stream
- ✅ Simpler than Redis key management
- ✅ Works with any eventStore adapter (Redis/Postgres/Memory)
- ✅ **Supports partial flow definitions** - Instances can register only their steps, entry optional

### Example: Distributed Flow Registry

**Scenario**: ML Pipeline split across 3 containers

**Instance 1** (Main App) - Has entry step:
```typescript
// server/queues/ml-pipeline-entry.ts
export const config = defineQueueConfig({
  queue: { name: 'api' },
  flow: {
    name: ['ml-pipeline'],
    role: 'entry',
    step: 'start',
    emits: ['data.ready']
  }
})

// Emits on startup (ONE step event):
// flow.step.registered {
//   flowName: 'ml-pipeline',
//   instanceId: 'main-app-1',
//   stepName: 'start',
//   queue: 'api',
//   workerId: 'ml-pipeline-entry',
//   role: 'entry',
//   subscribes: [],
//   emits: ['data.ready']
// }
```

**Instance 2** (ML Worker) - Has processing step only:
```python
# ml_worker/queues/train.py
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

# Emits on startup (ONE step event):
# flow.step.registered {
#   flowName: 'ml-pipeline',
#   instanceId: 'ml-worker-1',
#   stepName: 'train',
#   queue: 'ml-train',
#   workerId: 'ml-train-worker',
#   role: 'step',
#   subscribes: ['data.ready'],
#   emits: ['model.trained']
# }
```

**Instance 3** (Main App) - Has terminal step only:
```typescript
// server/queues/ml-pipeline-save.ts
export const config = defineQueueConfig({
  queue: { name: 'api' },
  flow: {
    name: ['ml-pipeline'],
    role: 'step',
    step: 'save',
    subscribes: ['model.trained']
  }
})

// Emits on startup (ONE step event):
// flow.step.registered {
//   flowName: 'ml-pipeline',
//   instanceId: 'main-app-2',
//   stepName: 'save',
//   queue: 'api',
//   workerId: 'ml-pipeline-save',
//   role: 'step',
//   subscribes: ['model.trained'],
//   emits: []
// }
```

**Merged Registry** (from `getFlow('ml-pipeline')` - built on-demand from step events):
```typescript
{
  entry: { queue: 'api', workerId: 'start', ... },  // From instance 1
  steps: {
    start: { queue: 'api', instanceId: 'main-app-1', ... },    // From instance 1
    train: { queue: 'ml-train', instanceId: 'ml-worker-1', ... }, // From instance 2
    save: { queue: 'api', instanceId: 'main-app-2', ... }      // From instance 3
  }
}
```

✅ **Key Advantages of Step-Based Registry**:

1. **No Flow Analyzer Dependency** - Instances don't need to know complete flow structure
2. **Perfect for Partial Instances** - Step-only instances just emit their step, no undefined entry needed
3. **Simpler Emission Logic** - Each worker emits one event per flow it belongs to
4. **Dynamic Flow Assembly** - Registry query builds flows on-demand from available steps
5. **Works with Any Combination** - Entry in one instance, steps in others, all automatic

### Registry Race Conditions & Mitigation

**Problem**: Instances start at different times, causing incomplete registry reads:

```
Timeline:
T0: Instance 1 starts → emits entry step
T1: Instance 2 starts → queries registry → sees only entry (missing train & save)
T2: Instance 3 starts → emits train step
T3: Instance 4 starts → emits save step
T4: Now registry is complete, but Instance 2 cached incomplete version
```

**Mitigation Strategies**:

#### 1. Health Check Before Usage

The `getFlow()` function now validates that all contributing instances are healthy:

```typescript
const flow = await registryQuery.getFlow('ml-pipeline')

if (flow._metadata?.allHealthy) {
  // Safe to use - all instances that registered are still alive
} else {
  // Some instances are dead - flow definition may be incomplete
  console.warn('Flow has unhealthy instances, retrying...')
}
```

#### 2. Wait for Flow Ready

Use `waitForFlowReady()` when initializing flows:

```typescript
// In API endpoint that starts flows
export default defineEventHandler(async (event) => {
  const registryQuery = createEventBasedRegistryQuery(getEventManager())
  
  try {
    // Wait up to 30s for all instances to register
    const flow = await registryQuery.waitForFlowReady('ml-pipeline', 30000)
    
    // Now safe to start flow - all steps are available
    await startFlow('ml-pipeline', data)
  } catch (error) {
    return { error: 'Flow not ready - some instances may not have started' }
  }
})
```

#### 3. Retry on Missing Steps

When triggering steps, handle missing queue handlers gracefully:

```typescript
// In flow engine trigger handler
const handlers = await registryQuery.getQueueHandlers(stepDef.queue)

if (handlers.length === 0) {
  console.error(`No handlers for queue ${stepDef.queue}, will retry...`)
  
  // Emit event for dead letter queue or retry
  await eventManager.emit('queue.unavailable', {
    queue: stepDef.queue,
    flowName,
    runId,
    stepName,
    timestamp: new Date().toISOString()
  })
  
  // Optionally: enqueue to retry queue with delay
  await ctx.provider.enqueue('retry', {
    originalQueue: stepDef.queue,
    flowName,
    runId,
    stepName,
    data,
    retryAfter: Date.now() + 5000  // Retry in 5s
  })
}
```

#### 4. Startup Coordination (Optional)

For critical flows, add explicit readiness checks:

```typescript
// docker-compose.yml with health checks
services:
  ml-worker:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/_health"]
      interval: 5s
      timeout: 3s
      retries: 3
      start_period: 10s
  
  main-app:
    depends_on:
      ml-worker:
        condition: service_healthy  # Wait for ML worker to be healthy
```

**Best Practice**: Use `waitForFlowReady()` in flow entry points (API handlers) and rely on heartbeat validation during execution.

## 2. Worker & Step Versioning

### Problem Statement

In distributed environments with rolling deployments:
- Multiple versions of the same worker may run simultaneously
- Flow steps may be updated independently
- Need to ensure compatible versions execute together
- Avoid routing jobs to incompatible worker versions

### Solution: Version-Aware Registry

Add version information to step registrations:

```typescript
interface FlowStepRegistration {
  flowName: string
  instanceId: string
  stepName: string
  queue: string
  workerId: string
  role: 'entry' | 'step'
  subscribes: string[]
  emits: string[]
  version: string  // NEW: Semantic version (e.g., "1.0.0")
  timestamp: string
}
```

### Implementation

#### Step Registration with Version

```typescript
// src/runtime/server/plugins/registry-emission.ts

export default defineNitroPlugin(async (nitro) => {
  const config = useRuntimeConfig()
  const registry = useRegistry()
  const eventManager = getEventManager()
  
  // Auto-generate instanceId if not provided
  const instanceId = config.queue.instanceId || hostname()
  
  console.log(`[nuxt-queue] Registering instance: ${instanceId}`)
  
  // Emit individual step registrations for each flow worker
  for (const worker of registry.workers) {
    if (!worker.flow) continue
    
    for (const flowName of worker.flow.names) {
      await eventManager.emit('flow.step.registered', {
        flowName,
        instanceId,
        stepName: worker.flow.step,
        queue: worker.queue.name,
        workerId: worker.id,
        role: worker.flow.role,
        subscribes: worker.flow.subscribes || [],
        emits: worker.flow.emits || [],
        version: worker.flow.version || config.queue.version || '1.0.0',  // Version from config or worker
        timestamp: new Date().toISOString()
      })
    }
  }
  
  console.log(
    `[nuxt-queue] Registered ${registry.workers.filter(w => w.flow).length} flow steps`
  )
  
  // Emit shutdown event when server closes
  nitro.hooks.hook('close', async () => {
    console.log(`[nuxt-queue] Shutting down instance: ${instanceId}`)
    
    await eventManager.emit('instance.shutdown', {
      instanceId,
      timestamp: new Date().toISOString()
    })
  })
})
```

#### Worker Configuration with Version

```typescript
// server/queues/ml-pipeline-train.ts (v2.0.0)
export const config = defineQueueConfig({
  queue: { name: 'ml-train' },
  flow: {
    name: ['ml-pipeline'],
    role: 'step',
    step: 'train',
    subscribes: ['data.ready'],
    emits: ['model.trained'],
    version: '2.0.0'  // Explicitly set version
  }
})
```

#### Registry Query with Version Filtering

```typescript
// src/runtime/server/utils/registryQuery.ts

export function createEventBasedRegistryQuery(
  eventManager: EventManager
): RegistryQuery {
  return {
    async getFlow(flowName, options?: { version?: string }) {
      const events = await eventManager.query({
        stream: REGISTRY_STREAM,
        types: ['flow.step.registered']
      })
      
      const stepEvents = events.filter(e => 
        e.type === 'flow.step.registered' && 
        e.data.flowName === flowName &&
        (!options?.version || e.data.version === options.version)
      )
      
      if (stepEvents.length === 0) return null
      
      // Build flow with version-aware steps
      const merged: FlowDefinition = {
        entry: undefined,
        steps: {},
        versions: new Set<string>()  // Track all versions
      }
      
      const contributingInstances = new Set<string>()
      
      for (const event of stepEvents) {
        const stepData = event.data
        contributingInstances.add(stepData.instanceId)
        merged.versions.add(stepData.version)
        
        if (stepData.role === 'entry') {
          merged.entry = {
            queue: stepData.queue,
            workerId: stepData.workerId,
            instanceId: stepData.instanceId,
            version: stepData.version
          }
        }
        
        // Handle multiple versions of same step
        const stepKey = `${stepData.stepName}@${stepData.version}`
        merged.steps[stepKey] = {
          queue: stepData.queue,
          workerId: stepData.workerId,
          instanceId: stepData.instanceId,
          subscribes: stepData.subscribes,
          emits: stepData.emits,
          version: stepData.version
        }
      }
      
      // Warn if multiple versions detected
      if (merged.versions.size > 1) {
        console.warn(
          `[nuxt-queue] Flow ${flowName} has multiple versions: ${Array.from(merged.versions).join(', ')}`
        )
      }
      
      return merged
    }
  }
}
```

### Version Strategies

#### 1. Strict Versioning (Recommended)

All steps in a flow must match version:

```typescript
// Global flow version in config
export default defineNuxtConfig({
  queue: {
    version: '2.0.0',  // All workers inherit this version
    versionStrategy: 'strict'  // Require exact version match
  }
})

// Query only matching version
const flow = await registryQuery.getFlow('ml-pipeline', { version: '2.0.0' })
```

#### 2. Latest Version (Rolling Deployments)

Use the newest version available:

```typescript
export default defineNuxtConfig({
  queue: {
    versionStrategy: 'latest'  // Use newest version of each step (default)
  }
})

// Registry query picks latest version per step
const flow = await registryQuery.getFlow('ml-pipeline')  // Auto-selects latest
```

#### 3. Mixed Versioning (Advanced)

Allow different step versions in same flow:

```typescript
export default defineNuxtConfig({
  queue: {
    versionStrategy: 'mixed',  // Allow version mismatches
    versionCompatibility: {
      'ml-pipeline': {
        'train': ['2.0.0', '2.1.0'],  // These versions are compatible
        'preprocess': ['1.5.0', '2.0.0']
      }
    }
  }
})
```

### Rolling Deployment Example

**Scenario**: Update `train` step from v1.0.0 to v2.0.0

```
Timeline:
T0: All instances running v1.0.0
    Flow: entry@1.0.0 → train@1.0.0 → save@1.0.0

T1: Deploy instance-2 with v2.0.0 train step
    Registry now has:
    - train@1.0.0 (instance-1)
    - train@2.0.0 (instance-2)
    
T2: New flows route to v2.0.0 (latest strategy)
    Existing flows complete on v1.0.0
    
T3: Deploy all instances with v2.0.0
    Flow: entry@2.0.0 → train@2.0.0 → save@2.0.0
```

### Benefits

- ✅ **Zero-downtime deployments** - Old and new versions coexist
- ✅ **Safe rollouts** - Test new versions in production gradually
- ✅ **Rollback capability** - Keep old version instances running
- ✅ **Version awareness** - Logs show which version processed each job
- ✅ **Compatibility validation** - Prevent incompatible step versions

### Storage Example

```typescript
// Redis Streams with versions
XADD nq:registry * 
  type "flow.step.registered" 
  flowName "ml-pipeline"
  instanceId "ml-worker-old"
  stepName "train"
  queue "ml-train"
  version "1.0.0"
  timestamp "2025-11-05T10:00:00Z"

XADD nq:registry * 
  type "flow.step.registered" 
  flowName "ml-pipeline"
  instanceId "ml-worker-new"
  stepName "train"
  queue "ml-train"
  version "2.0.0"
  timestamp "2025-11-05T10:05:00Z"
```

## 3. Cross-Container Event Routing

### Problem Statement

When a step completes and emits an event, the system needs to:
1. Find which queue handles the next step
2. Determine if that queue is available (healthy instance)
3. Enqueue the job to the correct queue

### Solution: Query Registry from Events

Use the event-based registry query instead of hardcoded aggregation:

```typescript
// In useFlowEngine.ts

export async function handleTrigger(
  eventName: string, 
  data: any, 
  ctx: WorkerContext
) {
  const eventManager = getEventManager()
  const registryQuery = createEventBasedRegistryQuery(eventManager)
  const { flowName, runId } = ctx
  
  // Get complete flow definition from event registry
  const flow = await registryQuery.getFlow(flowName)
  if (!flow) {
    throw new Error(`Flow ${flowName} not found in event registry`)
  }
  
  // Find steps that subscribe to this event
  const nextSteps = Object.entries(flow.steps)
    .filter(([_, step]) => step.subscribes?.includes(eventName))
  
  for (const [stepName, stepDef] of nextSteps) {
    // Check if queue has healthy handlers
    const handlers = await registryQuery.getQueueHandlers(stepDef.queue)
    
    if (handlers.length === 0) {
      console.error(`[nuxt-queue] No healthy instances for queue: ${stepDef.queue}`)
      
      // Emit event for monitoring/alerting
      await eventManager.emit('queue.unavailable', {
        queue: stepDef.queue,
        flowName,
        runId,
        stepName,
        timestamp: new Date().toISOString()
      })
      
      continue
    }
    
    // Enqueue job (provider routes via shared Redis/Postgres)
    await ctx.provider.enqueue(stepDef.queue, {
      name: stepName,
      data: {
        runId,
        flowName,
        trigger: eventName,
        ...data
      }
    })
    
    console.log(`[nuxt-queue] Triggered ${stepName} on queue ${stepDef.queue} (${handlers.length} handlers)`)
  }
}
```

### Benefits

- ✅ No separate aggregation service
- ✅ Query registry by reading events
- ✅ Automatic discovery of new instances
- ✅ Health check via heartbeat events
- ✅ Works with existing v0.5 infrastructure

## 4. Configuration

### Event-Based Registry Config

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['nuxt-queue'],
  
  queue: {
    // Optional: Instance identification (auto-generated from hostname if not provided)
    instanceId: process.env.INSTANCE_ID,
    
    // Optional: Heartbeat settings
    heartbeatInterval: 10000,  // 10 seconds (default)
    heartbeatTimeout: 30000,   // Consider dead after 30s without heartbeat (default)
    
    // EventStore configuration (required - already needed for v0.5 triggers)
    eventStore: {
      adapter: 'redis',  // 'redis', 'postgres', or 'memory' (for local dev)
      redis: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT || '6379')
      },
      mode: 'streams',
      options: {
        redisStreams: {
          trim: { 
            maxLen: 10000,  // Keep last 10k registry events
            approx: true 
          }
        }
      }
    },
    
    // Queue backend (must be shared for multi-instance)
    store: {
      adapter: 'redis',  // or 'memory' for local dev
      redis: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT || '6379')
      }
    },
    
    // State storage
    state: {
      adapter: 'redis',  // or 'memory' for local dev
      cleanup: {
        strategy: 'on-complete',
        ttlMs: 86400000  // Fallback: 24 hours
      }
    }
  }
})
```

### Local Development (Single Instance)

```typescript
// nuxt.config.ts - Simple local dev setup
export default defineNuxtConfig({
  modules: ['nuxt-queue'],
  
  queue: {
    // Use memory adapters - no Redis needed for local dev!
    eventStore: { adapter: 'memory' },
    store: { adapter: 'memory' },
    state: { adapter: 'memory' }
    
    // instanceId auto-generated, heartbeat uses defaults
    // Event-based registry still works, just in-memory
  }
})
```

### Production (Multi-Instance)

```typescript
// nuxt.config.ts - Production with Redis
export default defineNuxtConfig({
  modules: ['nuxt-queue'],
  
  queue: {
    instanceId: process.env.INSTANCE_ID,  // Set per container
    
    eventStore: {
      adapter: 'redis',
      redis: {
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT)
      }
    },
    
    store: {
      adapter: 'redis',
      redis: {
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT)
      }
    },
    
    state: {
      adapter: 'redis',
      cleanup: { strategy: 'on-complete' }
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
    command: redis-server --save 60 1 --loglevel warning
  
  # Main Nuxt app with API workers
  main-app:
    build: .
    environment:
      INSTANCE_ID: main-app-${HOSTNAME}
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
      INSTANCE_ID: ml-worker-${HOSTNAME}
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

volumes:
  redis-data:
  ml-models:
```

## 5. Deployment Workflow

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
  
  // Trigger ML step (event-based routing will find ml-worker)
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
  
  // Terminal step - flow.completed will be auto-emitted
  return { ok: true }
})
```

### Step 2: Deploy

```bash
docker-compose up -d
```

Each container on startup:
1. Compiles its partial registry
2. Emits `worker.registered` and `flow.registered` events to `nq:registry` stream
3. Starts heartbeat (emits `instance.heartbeat` every 10s)
4. Begins processing its queues

### Step 3: Monitor

Query the event-based registry:

```typescript
// API endpoint: /api/_registry
export default defineEventHandler(async () => {
  const eventManager = getEventManager()
  const registryQuery = createEventBasedRegistryQuery(eventManager)
  
  const healthyInstances = await registryQuery.getHealthyInstances()
  
  // Get all registered flows
  const registryEvents = await eventManager.query({
    stream: 'nq:registry',
    types: ['flow.registered']
  })
  
  const flows = new Set(
    registryEvents.map(e => e.data.flowName)
  )
  
  return {
    instances: healthyInstances,
    flowCount: flows.size,
    flows: Array.from(flows),
    registryEventCount: registryEvents.length
  }
})

// API endpoint: /api/_flows/[flowName]/runs/[runId]
export default defineEventHandler(async (event) => {
  const runId = getRouterParam(event, 'runId')
  const flowState = await getFlowState(runId)
  
  return {
    ...flowState,
    isComplete: flowState.status === 'completed',
    progress: `${flowState.completedSteps.length}/${flowState.terminalSteps.length} terminal steps`
  }
})
```

## 6. Benefits Summary

### Event-Based Registry
- ✅ Reuses v0.5 event infrastructure
- ✅ No separate Redis keys or aggregation logic
- ✅ Automatic persistence and audit trail
- ✅ Query by reading event stream
- ✅ Works with any eventStore adapter

### Flow Lifecycle Tracking
- ✅ Complete execution history per flow run
- ✅ Event sourcing enables time-travel debugging
- ✅ Distributed completion detection
- ✅ Enables `on-complete` cleanup strategy
- ✅ No separate tracking tables

### Operational Benefits
- ✅ Simpler than v0.6 aggregation approach
- ✅ True microservices architecture
- ✅ Language-agnostic workers
- ✅ Independent scaling per worker type
- ✅ Automatic instance discovery
- ✅ Zero-downtime deployments
- ✅ **Version-aware routing** - Rolling deployments with version compatibility

## 7. Comparison with v0.6 Approach

| Aspect | v0.6 (Aggregation Service) | v0.8 (Event-Based) |
|--------|---------------------------|-------------------|
| **Registry Storage** | Custom Redis keys + aggregation | EventStore (reuses v0.5) |
| **Registry Mode** | Optional (enabled flag) | **Always active** |
| **Complexity** | High (separate aggregator) | **Low** (step events only) |
| **Flow Tracking** | Separate Redis hash | **Optional** (TTL-based by default) |
| **Heartbeat** | Custom Redis key with TTL | Event in registry stream |
| **Query Method** | Direct Redis key reads | Event stream query |
| **Audit Trail** | No built-in history | Full event history |
| **Infrastructure** | New components | Reuses existing |
| **Local Dev** | Requires Redis | **Works with memory adapter** |
| **Postgres Support** | Limited | **Full support** |
| **Versioning** | Not supported | **Built-in version-aware routing** |
| **Migration** | Complex | Simple (event emission) |

**Key Improvements**:

- ✅ **No Toggle Needed** - Event-based registry always works, single or multi-instance
- ✅ **Simpler Config** - No `distributed.enabled` flag confusion
- ✅ **Better DX** - Same code path for dev (memory) and production (Redis/Postgres)
- ✅ **Zero Extra Infrastructure** - Already have eventStore for v0.5 triggers

## 8. Migration Path

### v0.8.0: Foundation (Required)
- Implement event-based registry emission (always active)
- Add registry query functions with version filtering
- Simplify configuration (remove `distributed.enabled` flag)
- Use TTL-based state cleanup

### v0.8.1: Advanced Versioning
- Version compatibility rules and strategies
- Rolling deployment patterns
- Version-aware routing optimization

### v0.8.2: Observability
- Registry monitoring endpoints with version info
- Version-aware health dashboards
- Flow tracing with version context

## 9. Testing Strategy

### Unit Tests
- Step-based event emission
- Registry query with version filtering
- Version compatibility validation
- Heartbeat mechanism

### Integration Tests
- Multi-instance registry merging
- Cross-container flow execution
- Version-aware routing
- Instance failure and recovery
- Rolling deployment scenarios

### E2E Tests
- Deploy multi-version containers
- Run distributed flows with version routing
- Test version compatibility rules
- Verify cleanup strategies (TTL-based)

### Load Tests
- Event stream performance under load
- Registry query latency with many versions
- Heartbeat reliability
- Version routing performance

## 10. Implementation Checklist

### Phase 1: Core Distributed Registry (Required)
- [ ] Add `flow.step.registered` event type to schema
- [ ] Implement event-based registry emission plugin (always active)
- [ ] Create `createEventBasedRegistryQuery()` utility
- [ ] Add heartbeat plugin (always active)
- [ ] Update `useFlowEngine` to query event registry
- [ ] Add `waitForFlowReady()` helper
- [ ] Simplify configuration types (remove `distributed.enabled` flag)
- [ ] Write registry tests (step emission, merging, health checks, version filtering)

### Phase 2: Version Management
- [ ] Add version configuration (global + per-worker)
- [ ] Implement version strategy (strict, latest, mixed)
- [ ] Add version compatibility rules
- [ ] Create version-aware routing logic
- [ ] Write version tests (compatibility, routing, rolling deployments)

### Phase 3: Monitoring & Observability
- [ ] Add `/api/_registry` endpoint (flows, instances, versions, health)
- [ ] Add `/api/_flows/[flow]/versions` endpoint
- [ ] Create version-aware health dashboards
- [ ] Update documentation with versioning patterns
- [ ] Create Docker Compose examples with version scenarios

## 11. Summary

**v0.8 Event-Based Architecture**:
- ✅ Event-based registry (always active, no toggle needed)
- ✅ Built-in versioning for rolling deployments
- ✅ TTL-based state cleanup (no complex lifecycle)
- ✅ Full Postgres support
- ✅ Works with any eventStore backend

**Key Design Decisions**:

1. **Always Event-Based** - No local-only mode. Registry emission is always active.
2. **Worker Versioning** - Zero-downtime deployments with version routing.
3. **Simple Cleanup** - TTL-based or developer-managed (no atomic completion tracking).
4. **Zero Config for Dev** - Memory adapters work out of the box, no Redis needed locally.

**Why This Works**:
- Single code path for single and multi-instance deployments
- Event-based registry provides observability even in dev
- Versioning enables production patterns without complexity
- No Redis Lua scripts or race condition handling needed
- Already have eventStore infrastructure from v0.5

**Developer Experience**:

```typescript
// Local dev - works immediately, no Redis
export default defineNuxtConfig({
  queue: {
    eventStore: { adapter: 'memory' }  // That's it!
  }
})

// Production - just add shared storage
export default defineNuxtConfig({
  queue: {
    instanceId: process.env.INSTANCE_ID,
    eventStore: { 
      adapter: 'redis',
      redis: { host: process.env.REDIS_HOST }
    }
  }
})
```

The design focuses on simplicity and consistency: one registry pattern that scales from local development to distributed production.
