# Worker Execution Architecture

> **Version**: v0.6.4  
> **Status**: 📋 Planning  
> **Last Updated**: 2025-11-05  
> **Integrates With**: v0.6 (State, Dev Adapters, Multi-Language), v0.8 (Registry)

## Overview

This spec defines the complete worker execution architecture in nuxt-queue, separating concerns between **queue management** (QueueProvider) and **worker execution** (WorkerManager). This separation enables multiple queue backends (BullMQ, Memory, File) while maintaining consistent worker behavior.

### Architecture Layers

```
┌─────────────────────────────────────────────────────────────┐
│                     Application Layer                       │
│  (Queue workers defined in server/queues/)                  │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Registry Layer (v0.8)                    │
│  - Scans server/queues/ for workers                         │
│  - Builds worker metadata (queue, config, flow, etc.)       │
│  - Provides unified worker catalog                          │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   Worker Manager Layer                      │
│  - Registers workers with QueueProvider                     │
│  - Creates worker instances (BullMQ Workers, fastq, etc.)   │
│  - Dispatches jobs to handlers                              │
│  - Handles runtime selection (Node.js, Python, etc.)        │
└────────┬───────────────────────────────┬────────────────────┘
         │                               │
         ▼                               ▼
┌─────────────────────┐     ┌─────────────────────────────────┐
│  QueueProvider      │     │  Runner Layer                   │
│  - Job operations   │     │  - Builds execution context     │
│  - Queue state      │     │  - Executes handler             │
│  - Event emission   │     │  - Emits step events            │
│  (BullMQ/Memory/    │     │  - State/logger wiring          │
│   File)             │     │  (node.ts, python.ts, etc.)     │
└─────────────────────┘     └─────────────────────────────────┘
```

## 1. Separation of Concerns

### QueueProvider Interface (Queue Management Only)

```typescript
// src/runtime/server/queue/types.ts

/**
 * QueueProvider: Manages job queues ONLY
 * Does NOT execute workers - that's WorkerManager's job
 */
export interface QueueProvider {
  // Initialize provider
  init(): Promise<void>
  
  // Enqueue jobs
  enqueue(queueName: string, job: JobInput): Promise<string>
  schedule(queueName: string, job: JobInput, opts?: ScheduleOptions): Promise<string>
  
  // Query jobs
  getJob(queueName: string, id: string): Promise<Job | null>
  getJobs(queueName: string, query?: JobsQuery): Promise<Job[]>
  
  // Queue control
  pause(queueName: string): Promise<void>
  resume(queueName: string): Promise<void>
  isPaused(queueName: string): Promise<boolean>
  getJobCounts(queueName: string): Promise<JobCounts>
  
  // Event subscription
  on(queueName: string, event: QueueEvent, callback: (payload: any) => void): () => void
  
  // Cleanup
  close(): Promise<void>
}
```

**Key Point**: QueueProvider is "dumb" - it only manages the job queue. Worker execution happens separately in WorkerManager.

### WorkerManager Interface (Worker Execution)

```typescript
// src/runtime/server/worker/types.ts

/**
 * WorkerManager: Registers and executes workers
 * Works with any QueueProvider (BullMQ, Memory, File)
 */
export interface WorkerManager {
  // Register a worker handler for a specific job type on a queue
  registerWorker(
    queueName: string, 
    jobName: string, 
    handler: WorkerHandler, 
    opts?: WorkerOptions
  ): Promise<void>
  
  // Get registered worker info
  getWorker(queueName: string, jobName: string): WorkerInfo | null
  
  // Cleanup all workers
  closeAll(): Promise<void>
}

export interface WorkerHandler {
  (input: any, ctx: RunContext): Promise<any>
}

export interface WorkerInfo {
  queueName: string
  jobName: string
  handler: WorkerHandler
  runtime: 'node' | 'python' | 'node-isolated'
  concurrency: number
  autorun: boolean
}

export interface WorkerOptions {
  concurrency?: number
  lockDurationMs?: number
  maxStalledCount?: number
  drainDelayMs?: number
  autorun?: boolean
  prefix?: string
  runtime?: 'node' | 'python' | 'node-isolated'
}
```

## 2. BullMQ Worker Manager (Current Implementation)

Your current implementation in `adapter.ts` already follows this pattern:

### Registration Flow

```typescript
// src/runtime/server/worker/adapter.ts

/**
 * BullMQ Worker Manager
 * Creates BullMQ Worker instances that dispatch to handlers
 */

interface QueueWorkerInfo {
  worker: Worker // BullMQ Worker instance
  handlers: Map<string, NodeHandler> // jobName -> handler
}

const registeredWorkers = new Map<string, QueueWorkerInfo>()

export async function registerTsWorker(
  queueName: string, 
  jobName: string, 
  handler: NodeHandler, 
  opts?: any
) {
  let info = registeredWorkers.get(queueName)

  if (info) {
    // Worker already exists - just add handler
    console.info(`Adding handler for job "${jobName}" to queue "${queueName}"`)
    info.handlers.set(jobName, handler)
    return info.worker
  }

  // Create new BullMQ Worker with dispatcher
  console.info(`Creating new worker for queue: ${queueName}`)

  const handlers = new Map<string, NodeHandler>()
  handlers.set(jobName, handler)

  // Dispatcher routes to correct handler based on job.name
  const dispatcher = async (job: any) => {
    const handler = handlers.get(job.name)
    if (!handler) {
      throw new Error(
        `No handler for job "${job.name}" on queue "${queueName}". ` +
        `Available: ${Array.from(handlers.keys()).join(', ')}`
      )
    }

    // Create processor and execute
    const processor = createBullMQProcessor(handler, queueName)
    return processor(job)
  }

  const rc: any = useRuntimeConfig()
  const connection = rc?.queue?.queue?.redis

  const shouldPause = opts?.autorun === false

  // Create BullMQ Worker
  const worker = new Worker(queueName, dispatcher, { connection, ...(opts || {}) })

  if (shouldPause) {
    await worker.pause()
    console.info(`Worker for "${queueName}" created but paused (autorun: false)`)
  }

  // Error handling
  worker.on('error', (err) => {
    console.error(`[Worker] Error in worker for queue "${queueName}":`, err)
  })

  worker.on('failed', (job, err) => {
    console.error(`[Worker] Job failed in queue "${queueName}":`, {
      jobId: job?.id,
      jobName: job?.name,
      error: err.message,
    })

    // Emit step.failed event
    const flowId = job?.data?.flowId
    if (flowId) {
      const eventMgr = useEventManager()
      eventMgr.publishBus({
        type: 'step.failed',
        runId: flowId,
        flowName: job?.data?.flowName || 'unknown',
        stepName: job.name,
        stepId: `${flowId}__${job.name}__worker-error`,
        data: {
          error: err.message,
          stack: err.stack,
        },
      } as any).catch(() => {})
    }
  })

  info = { worker, handlers }
  registeredWorkers.set(queueName, info)

  return worker
}

export async function closeAllWorkers() {
  const closePromises: Promise<void>[] = []
  for (const [queueName, info] of registeredWorkers.entries()) {
    closePromises.push(
      info.worker.close().catch((err) => {
        // Ignore EPIPE during HMR
        if (err.code !== 'EPIPE' && !err.message?.includes('Connection is closed')) {
          console.warn(`Error closing worker "${queueName}":`, err.message)
        }
      })
    )
  }
  await Promise.allSettled(closePromises)
  registeredWorkers.clear()
  console.info('[closeAllWorkers] All workers closed')
}
```

**Key Points**:
- ✅ One BullMQ Worker per queue (not per job)
- ✅ Dispatcher pattern routes jobs to correct handler
- ✅ Handlers registered dynamically
- ✅ Worker lifecycle managed separately from queue
- ✅ Error handling emits step.failed events

## 3. Memory Worker Manager (New)

For memory adapter, we need equivalent worker management using fastq:

```typescript
// src/runtime/server/worker/adapters/memory.ts

import fastq from 'fastq'
import { createNodeProcessor } from '../runner/node'
import type { WorkerHandler, WorkerInfo, WorkerOptions } from '../types'

interface QueueWorkerInfo {
  queue: fastq.queue
  handlers: Map<string, WorkerHandler>
  paused: boolean
}

export class MemoryWorkerManager {
  private workers = new Map<string, QueueWorkerInfo>()

  async registerWorker(
    queueName: string,
    jobName: string,
    handler: WorkerHandler,
    opts?: WorkerOptions
  ): Promise<void> {
    let info = this.workers.get(queueName)

    if (info) {
      // Worker exists - add handler
      console.info(`[Memory] Adding handler for job "${jobName}" to queue "${queueName}"`)
      info.handlers.set(jobName, handler)
      return
    }

    // Create new fastq worker with dispatcher
    console.info(`[Memory] Creating new worker for queue: ${queueName}`)

    const handlers = new Map<string, WorkerHandler>()
    handlers.set(jobName, handler)

    // Dispatcher routes to correct handler
    const dispatcher = async (task: { jobId: string, jobName: string, data: any }) => {
      const handler = handlers.get(task.jobName)
      if (!handler) {
        throw new Error(
          `No handler for job "${task.jobName}" on queue "${queueName}". ` +
          `Available: ${Array.from(handlers.keys()).join(', ')}`
        )
      }

      // Create processor (same as BullMQ)
      const processor = createNodeProcessor(handler, queueName)
      
      // Execute with mock job object (fastq doesn't have Job type)
      const mockJob = {
        id: task.jobId,
        name: task.jobName,
        data: task.data,
        attemptsMade: 0,
        opts: {},
      }
      
      return await processor(mockJob)
    }

    // Create fastq queue
    const queue = fastq(this, dispatcher, opts?.concurrency || 1)
    
    const shouldPause = opts?.autorun === false
    
    info = {
      queue,
      handlers,
      paused: shouldPause || false,
    }
    
    if (shouldPause) {
      queue.pause()
      console.info(`[Memory] Worker for "${queueName}" created but paused`)
    }

    this.workers.set(queueName, info)
  }

  async closeAll(): Promise<void> {
    const drainPromises = Array.from(this.workers.values())
      .map(w => w.queue.drained())
    
    await Promise.all(drainPromises)
    this.workers.clear()
    console.info('[Memory] All workers closed')
  }

  // Called by MemoryQueueProvider when job is enqueued
  async dispatchJob(queueName: string, jobId: string, jobName: string, data: any): Promise<void> {
    const info = this.workers.get(queueName)
    if (!info) {
      throw new Error(`No worker registered for queue "${queueName}"`)
    }

    if (info.paused) {
      console.warn(`Queue "${queueName}" is paused, job ${jobId} won't be processed`)
      return
    }

    // Push to fastq
    info.queue.push({ jobId, jobName, data })
  }

  getWorker(queueName: string, jobName: string): WorkerInfo | null {
    const info = this.workers.get(queueName)
    if (!info) return null

    const handler = info.handlers.get(jobName)
    if (!handler) return null

    return {
      queueName,
      jobName,
      handler,
      runtime: 'node',
      concurrency: info.queue.concurrency,
      autorun: !info.paused,
    }
  }
}

// Singleton instance
let memoryWorkerManager: MemoryWorkerManager | null = null

export function getMemoryWorkerManager(): MemoryWorkerManager {
  if (!memoryWorkerManager) {
    memoryWorkerManager = new MemoryWorkerManager()
  }
  return memoryWorkerManager
}
```

### Integration with MemoryQueueProvider

```typescript
// Update MemoryQueueProvider to work with MemoryWorkerManager

export class MemoryQueueProvider implements QueueProvider {
  async enqueue(queueName: string, job: JobInput): Promise<string> {
    const jobId = this.generateId()
    
    // Store job
    const internalJob: Job = {
      id: jobId,
      name: job.name,
      data: job.data,
      state: 'waiting',
      timestamp: Date.now()
    }
    
    this.jobs.set(jobId, internalJob)
    
    // Emit waiting event
    this.emitEvent(queueName, 'waiting', { jobId })
    
    // Dispatch to worker manager
    const workerMgr = getMemoryWorkerManager()
    await workerMgr.dispatchJob(queueName, jobId, job.name, job.data)
    
    return jobId
  }
}
```

## 4. Worker Registration Plugin

The Nitro plugin registers all workers on startup:

```typescript
// src/runtime/server/plugins/workers.ts

import { defineNitroPlugin, $useWorkerHandlers, $useQueueRegistry } from '#imports'
import { getWorkerManager } from '../worker/factory'

export default defineNitroPlugin(async (nitroApp) => {
  const workerManager = getWorkerManager() // Gets BullMQ/Memory/File manager based on config

  // Close all workers on shutdown
  nitroApp.hooks.hook('close', async () => {
    await workerManager.closeAll()
  })

  try {
    const handlers = $useWorkerHandlers() as ReadonlyArray<HandlerEntry>
    const registry = $useQueueRegistry() as any

    for (const entry of handlers) {
      const { queue, id, handler } = entry

      // Find worker in registry
      const w = registry.workers.find((rw: any) => 
        (rw?.id === id) || (rw?.queue?.name === queue && rw?.absPath === entry.absPath)
      )

      // Determine job name
      let jobName: string
      if (w?.flow?.step) {
        jobName = Array.isArray(w.flow.step) ? w.flow.step[0] : w.flow.step
      } else {
        jobName = id.includes('/') ? id.split('/').pop() : id
      }

      if (typeof handler === 'function') {
        const cfg = w?.worker || {}
        
        // Map config to worker options
        const opts: WorkerOptions = {
          concurrency: cfg.concurrency,
          lockDurationMs: cfg.lockDurationMs,
          maxStalledCount: cfg.maxStalledCount,
          drainDelayMs: cfg.drainDelayMs,
          autorun: cfg.autorun,
          prefix: w?.queue?.prefix,
          runtime: cfg.runtime || 'node', // Default to Node.js
        }

        // Register worker
        await workerManager.registerWorker(queue, jobName, handler, opts)
      }
    }
  } catch {
    // Ignore if template not present
  }
})
```

### Worker Manager Factory

```typescript
// src/runtime/server/worker/factory.ts

import { useRuntimeConfig } from '#imports'
import type { WorkerManager } from './types'

let workerManager: WorkerManager | null = null

export function getWorkerManager(): WorkerManager {
  if (workerManager) return workerManager

  const rc = useRuntimeConfig() as any
  const adapter = rc.queue?.adapter || 'memory'

  switch (adapter) {
    case 'memory':
      workerManager = new MemoryWorkerManager()
      break
    case 'file':
      workerManager = new FileWorkerManager()
      break
    case 'redis':
      workerManager = new BullMQWorkerManager()
      break
    case 'postgres':
      workerManager = new PgBossWorkerManager()
      break
    default:
      throw new Error(`Unknown worker adapter: ${adapter}`)
  }

  return workerManager
}
```

## 5. Runner Layer (Context & Events)

The runner layer (already implemented in `runner/node.ts`) builds execution context and emits events:

```typescript
// src/runtime/server/worker/runner/node.ts

export function createBullMQProcessor(handler: NodeHandler, queueName: string) {
  return async function processor(job: BullJob) {
    const eventMgr = useEventManager()
    const flowId = job.data?.flowId || randomUUID()
    const flowName = job.data?.flowName || 'unknown'
    const attempt = (job.attemptsMade || 0) + 1
    const stepRunId = `${flowId}__${job.name}__attempt-${attempt}`

    // Build context
    const ctx = buildContext({
      jobId: job.id as string,
      queue: queueName,
      flowId,
      flowName,
      stepName: job.name,
      stepId: stepRunId,
      attempt,
    })

    // Emit step.started
    await eventMgr.publishBus({
      type: 'step.started',
      runId: flowId,
      flowName,
      stepName: job.name,
      stepId: stepRunId,
      attempt,
      data: { jobId: job.id, name: job.name, queue: queueName },
    })

    try {
      // Execute handler
      const result = await handler(job.data, ctx)

      // Emit step.completed
      await eventMgr.publishBus({
        type: 'step.completed',
        runId: flowId,
        flowName,
        stepName: job.name,
        stepId: stepRunId,
        attempt,
        data: { result },
      })

      return result
    } catch (err) {
      // Emit step.failed or step.retry
      const maxAttempts = job.opts?.attempts || 1
      const willRetry = attempt < maxAttempts

      if (willRetry) {
        await eventMgr.publishBus({
          type: 'step.retry',
          runId: flowId,
          flowName,
          stepName: job.name,
          stepId: stepRunId,
          attempt,
          data: {
            error: err.message,
            nextAttempt: attempt + 1,
          },
        })
      } else {
        await eventMgr.publishBus({
          type: 'step.failed',
          runId: flowId,
          flowName,
          stepName: job.name,
          stepId: stepRunId,
          attempt,
          data: {
            error: err.message,
            stack: err.stack,
          },
        })
      }

      throw err
    }
  }
}
```

**Key Points**:
- ✅ Same runner for all adapters (BullMQ, Memory, File)
- ✅ Context includes state, logger, flow engine
- ✅ Events emitted at all lifecycle points
- ✅ Retry logic with proper events

## 6. Multi-Runtime Support

For Python and isolated Node.js workers, the WorkerManager spawns child processes:

```typescript
// src/runtime/server/worker/adapters/multi-runtime.ts

export class MultiRuntimeWorkerManager extends BullMQWorkerManager {
  async registerWorker(
    queueName: string,
    jobName: string,
    handler: WorkerHandler,
    opts?: WorkerOptions
  ): Promise<void> {
    // Check if this is a multi-runtime worker
    const runtime = opts?.runtime || 'node'

    if (runtime === 'python' || runtime === 'node-isolated') {
      // Wrap handler in child process executor
      const wrappedHandler = this.createChildProcessHandler(handler, runtime, opts)
      
      // Register wrapped handler with BullMQ
      await super.registerWorker(queueName, jobName, wrappedHandler, opts)
    } else {
      // Standard Node.js worker
      await super.registerWorker(queueName, jobName, handler, opts)
    }
  }

  private createChildProcessHandler(
    originalHandler: WorkerHandler,
    runtime: 'python' | 'node-isolated',
    opts?: WorkerOptions
  ): WorkerHandler {
    return async (input: any, ctx: RunContext) => {
      // Spawn child process
      const childProcess = spawn(
        runtime === 'python' ? 'python3' : 'node',
        [/* handler path */],
        { stdio: ['pipe', 'pipe', 'pipe'] }
      )

      // Setup RPC communication
      const rpc = new ChildProcessRPC(childProcess)

      // Forward context methods via RPC
      rpc.addMethod('ctx.state.get', (params) => ctx.state.get(params.key))
      rpc.addMethod('ctx.state.set', (params) => ctx.state.set(params.key, params.value))
      rpc.addMethod('ctx.logger.log', (params) => ctx.logger.log(params.level, params.message, params.metadata))
      rpc.addMethod('ctx.flow.emit', (params) => ctx.flow.emit(params.trigger, params.payload))

      // Execute job in child process
      const result = await rpc.call('execute', { job: input, context: ctx })

      // Cleanup
      childProcess.kill()

      return result
    }
  }
}
```

See [multi-language-workers.md](./multi-language-workers.md) for full details on child process execution.

## 7. Complete Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                        Application Code                          │
│  server/queues/hello.ts                                          │
│  server/queues/example/first_step.ts                             │
│  server/queues/ml-flow/train_model.py                            │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Registry                             │
│  Scans workers, builds metadata                                  │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│              Nitro Plugin (plugins/workers.ts)                   │
│  Registers all workers on startup                                │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│                    WorkerManager Factory                         │
│  Selects adapter: BullMQ / Memory / File / PgBoss               │
└───────┬──────────────────────────────────┬───────────────────────┘
        │                                  │
        ▼                                  ▼
┌────────────────────┐          ┌──────────────────────────┐
│  BullMQ Worker     │          │  Memory Worker Manager   │
│  Manager           │          │  (fastq-based)           │
│                    │          │                          │
│  • Creates BullMQ  │          │  • Creates fastq queues  │
│    Workers         │          │  • Dispatches to         │
│  • Dispatcher      │          │    handlers              │
│    pattern         │          │  • Same dispatcher       │
│  • Redis-backed    │          │    pattern               │
│                    │          │  • In-memory             │
└─────────┬──────────┘          └────────┬─────────────────┘
          │                              │
          │    Both use Runner Layer    │
          │                              │
          └──────────────┬───────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Runner Layer (runner/node.ts)                 │
│                                                                  │
│  createBullMQProcessor(handler, queueName)                      │
│  • Builds RunContext (state, logger, flow)                      │
│  • Emits step.started                                           │
│  • Executes handler(job.data, ctx)                              │
│  • Emits step.completed / step.failed / step.retry              │
│                                                                  │
└───────────────────────┬──────────────────────────────────────────┘
                        │
                        ├─────────── Standard Node.js Handler
                        │            (executes directly)
                        │
                        └─────────── Multi-Runtime Handler
                                     (spawns child process)
                                     • Python worker
                                     • Isolated Node.js worker
                                     • RPC communication
```

## 8. Key Architectural Decisions

### ✅ Separation of Concerns

- **QueueProvider**: Job queue operations only (enqueue, getJob, pause, etc.)
- **WorkerManager**: Worker registration and execution
- **Runner**: Context building and event emission
- **EventManager**: Event storage and streaming (separate system)
- **StateProvider**: State management (separate system)

### ✅ Unified Worker Interface

All adapters (BullMQ, Memory, File, PgBoss) implement the same WorkerManager interface, so application code is identical.

### ✅ Dispatcher Pattern

One worker per queue, handlers registered dynamically by job name. This is more efficient than one worker per job type.

### ✅ Consistent Runner

The same runner (createBullMQProcessor) works for all adapters. Only the worker management differs.

### ✅ Multi-Runtime Support

Child process execution is handled transparently within WorkerManager, not as a separate system.

## 9. Implementation Checklist

- [ ] Create `WorkerManager` interface
- [ ] Rename `adapter.ts` → `bullmq-worker-manager.ts` (clarity)
- [ ] Create `MemoryWorkerManager` class
- [ ] Create `FileWorkerManager` class (similar to Memory)
- [ ] Create `WorkerManager` factory (selects based on config)
- [ ] Update Nitro plugin to use factory
- [ ] Create `MultiRuntimeWorkerManager` (extends BullMQ manager)
- [ ] Add Python/isolated Node.js child process support
- [ ] Write tests for all worker managers
- [ ] Document worker execution flow

## 10. Migration Guide

### Current Code (BullMQ-specific)

```typescript
import { registerTsWorker } from '../worker/adapter'

await registerTsWorker('my-queue', 'my-job', handler, opts)
```

### New Code (Adapter-agnostic)

```typescript
import { getWorkerManager } from '../worker/factory'

const workerManager = getWorkerManager() // Auto-selects BullMQ/Memory/File
await workerManager.registerWorker('my-queue', 'my-job', handler, opts)
```

The factory automatically selects the correct WorkerManager based on config, so the same code works with any adapter.

## 11. Benefits

✅ **Clean Separation**: Queue operations separate from worker execution  
✅ **Unified Interface**: Same code for all adapters (BullMQ, Memory, File)  
✅ **Easy Testing**: Memory adapter for fast unit tests  
✅ **Multi-Runtime**: Python and isolated Node.js workers supported  
✅ **Consistent Events**: Same events emitted regardless of adapter  
✅ **Production-Ready**: BullMQ for production, Memory/File for dev

## 12. Future Enhancements

- **PgBoss Worker Manager**: Same pattern for PostgreSQL
- **SQLite Worker Manager**: File-based queue with SQLite
- **Worker Pools**: Separate worker processes per queue
- **Load Balancing**: Distribute workers across machines
- **Dynamic Scaling**: Auto-scale workers based on queue depth
