# Multi-Language Workers (Python & Isolated Node.js)

> **Version**: v0.6.5  
> **Status**: 📋 Planning  
> **Last Updated**: 2025-11-05  
> **Integrates With**: v0.6 (Worker Execution), v0.8 (Registry)

## Goal

Enable Python and isolated Node.js workers via child processes, integrated into the WorkerManager architecture.

## Architecture

Multi-language support is implemented as an **extension of WorkerManager**, not a separate system. Workers are registered normally via the registry, and the WorkerManager transparently spawns child processes when needed.

### Key Design Principles

- **Integrated with WorkerManager**: Multi-runtime workers use the same registration flow as standard Node.js workers
- **Transparent to Application**: Worker code doesn't know if it's running in-process or as child process
- **Same Context API**: Python workers have same `ctx.state`, `ctx.logger`, `ctx.flow` as Node.js workers
- **Child Process per Job**: Spawn on demand, cleanup after completion (no process pools)
- **RPC Communication**: Context methods (state, logger, emit) forwarded via JSON-RPC

```
┌──────────────────────────────────────────────────────────────┐
│                 Application Layer (Registry)                 │
│  server/queues/hello.ts         (runtime: 'node')            │
│  server/queues/ml/train.py      (runtime: 'python')          │
│  server/queues/heavy/compute.ts (runtime: 'node-isolated')   │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│           Nitro Plugin (plugins/workers.ts)                  │
│  Registers all workers via WorkerManager                     │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                    WorkerManager                             │
│  (BullMQ/Memory/File - all support multi-runtime)           │
│                                                              │
│  registerWorker(queue, job, handler, opts)                  │
│  • Check opts.runtime                                       │
│  • If 'python' or 'node-isolated':                          │
│    → Wrap handler in ChildProcessRunner                     │
│  • Register wrapped handler                                 │
└────────────────────────┬─────────────────────────────────────┘
                         │
         ┌───────────────┴───────────────┐
         │                               │
         ▼                               ▼
┌────────────────────┐         ┌─────────────────────────┐
│  Standard Node.js  │         │  Child Process Runner   │
│  Handler           │         │                         │
│  (in-process)      │         │  Spawns:               │
│                    │         │  • Python process      │
│  • Direct call     │         │  • Isolated Node.js    │
│  • Same thread     │         │                         │
│                    │         │  • RPC communication   │
│                    │         │  • Context forwarding  │
└────────────────────┘         └─────────────────────────┘
```

### Flow Comparison

**Standard Node.js Worker**:
```
Job enqueued → Worker dispatcher → Handler executes (in-process) → Result returned
```

**Python/Isolated Worker**:
```
Job enqueued → Worker dispatcher → ChildProcessRunner spawns process
            → RPC setup → Handler executes (child process) 
            → Context calls via RPC → Result via RPC → Process cleanup → Result returned
```

## Worker Registration

Workers declare their runtime in config, registry detects it, WorkerManager handles execution:

### Python Worker

```python
# server/queues/ml-flow/train_model.py
from nuxt_queue import define_worker, define_config, RunContext

async def handler(job: dict, ctx: RunContext):
    """Train ML model with data from previous step"""
    data = job['data']
    
    # Full context support via RPC (transparent to worker)
    ctx.logger.info('Training model', {'samples': len(data['samples'])})
    
    # State management (RPC to parent)
    await ctx.state.set('model_version', '1.0')
    
    # Training
    model = train_model(data['samples'])
    
    # Emit events (RPC to parent)
    ctx.emit({
        'type': 'emit',
        'data': {
            'name': 'model.trained',
            'accuracy': model.accuracy
        }
    })
    
    return {'accuracy': model.accuracy, 'version': '1.0'}

# Worker config
config = define_config({
    'runtime': 'python',              # ← Indicates Python child process
    'concurrency': 2,
    'flow': {
        'role': 'step',
        'subscribes': ['data.prepared'],
        'emits': ['model.trained']
    }
})
```

**Key Point**: Worker code is identical to how it would be if running in-process. The `runtime: 'python'` in config triggers child process execution transparently.
```

### Isolated Node.js Worker

Runs in child process for isolation (heavy computation, unreliable packages):

```typescript
// server/queues/heavy-processing/compute.ts
export default defineQueueWorker(async (job, ctx) => {
  // Runs in isolated child process
  // Heavy computation won't block main worker pool
  const result = await heavyComputation(job.data)
  
  ctx.logger.log('info', 'Computation complete')
  return result
})

export const config = defineQueueConfig({
  runtime: 'node-isolated',           // ← Run in child process
  timeout: 600000,                    // 10 minute timeout
  concurrency: 1,
  flow: {
    role: 'step',
    subscribes: ['data.ready'],
    emits: ['compute.done']
  }
})
```

### Standard Node.js Worker

Runs in worker pool (default, no child process):

```typescript
// server/queues/tasks/send-email.ts
export default defineQueueWorker(async (job, ctx) => {
  await sendEmail(job.data)
  return { sent: true }
})

export const config = defineQueueConfig({
  // No runtime specified = runs in standard worker pool (in-process)
  concurrency: 10
})
```

## ChildProcessRunner Implementation

The WorkerManager wraps multi-runtime handlers with ChildProcessRunner:

```typescript
// src/runtime/server/worker/runner/child-process.ts

import { spawn, ChildProcess } from 'child_process'
import { JSONRPCServer, JSONRPCClient } from 'json-rpc-2.0'
import type { WorkerHandler, RunContext } from '../types'

/**
 * ChildProcessRunner: Executes worker in isolated child process
 * 
 * Wraps a handler to run in child process with RPC communication
 * Provides transparent context forwarding (state, logger, flow)
 */
export class ChildProcessRunner {
  private process: ChildProcess | null = null
  private rpcServer = new JSONRPCServer()
  private rpcClient: JSONRPCClient
  
  constructor(
    private workerPath: string,
    private runtime: 'python' | 'node-isolated',
    private timeout: number = 300000 // 5 minutes default
  ) {
    // RPC client sends requests to child process
    this.rpcClient = new JSONRPCClient((request) => {
      if (this.process?.stdin) {
        this.process.stdin.write(JSON.stringify(request) + '\n')
      }
    })
  }
  
  /**
   * Create a wrapped handler that executes in child process
   * This handler is registered with WorkerManager like any other handler
   */
  createHandler(): WorkerHandler {
    return async (input: any, ctx: RunContext) => {
      return this.execute(input, ctx)
    }
  }
  
  private async execute(input: any, ctx: RunContext): Promise<any> {
    // Setup RPC methods (context forwarding)
    this.setupRPCMethods(ctx)
    
    // Spawn child process
    this.process = spawn(
      this.runtime === 'python' ? 'python3' : 'node',
      this.getProcessArgs(),
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          NUXT_QUEUE_CHILD_PROCESS: '1'
        }
      }
    )
    
    // Setup communication
    this.setupProcessIO()
    
    try {
      // Send job to child process via RPC
      const result = await Promise.race([
        this.rpcClient.request('execute', {
          job: input,
          context: {
            jobId: ctx.jobId,
            queue: ctx.queue,
            flowId: ctx.flowId,
            flowName: ctx.flowName,
            stepName: ctx.stepName,
            stepId: ctx.stepId,
            attempt: ctx.attempt
          }
        }),
        this.createTimeout()
      ])
      
      return result
    } finally {
      // Cleanup
      await this.cleanup()
    }
  }
  
  private setupRPCMethods(ctx: RunContext) {
    // Child process can call these via RPC
    
    this.rpcServer.addMethod('ctx.state.get', async (params: { key: string }) => {
      return await ctx.state.get(params.key)
    })
    
    this.rpcServer.addMethod('ctx.state.set', async (params: { key: string, value: any, opts?: any }) => {
      return await ctx.state.set(params.key, params.value, params.opts)
    })
    
    this.rpcServer.addMethod('ctx.state.delete', async (params: { key: string }) => {
      return await ctx.state.delete(params.key)
    })
    
    this.rpcServer.addMethod('ctx.logger.log', async (params: { level: string, message: string, metadata?: any }) => {
      ctx.logger.log(params.level as any, params.message, params.metadata)
    })
    
    this.rpcServer.addMethod('ctx.flow.emit', async (params: { trigger: string, payload: any }) => {
      return await ctx.flow.emit(params.trigger, params.payload)
    })
  }
  
  private setupProcessIO() {
    // Handle stdout (RPC responses)
    this.process!.stdout?.on('data', (data) => {
      const lines = data.toString().split('\n')
      for (const line of lines) {
        if (!line.trim()) continue
        
        try {
          const message = JSON.parse(line)
          
          // Handle RPC request from child (context calls)
          if (message.method) {
            this.rpcServer.receive(message).then((response) => {
              if (response && this.process?.stdin) {
                this.process.stdin.write(JSON.stringify(response) + '\n')
              }
            })
          }
          // Handle RPC response to parent (job result)
          else if (message.result !== undefined || message.error) {
            this.rpcClient.receive(message)
          }
        } catch (e) {
          // Not JSON, might be regular output
          console.log('[child]', line)
        }
      }
    })
    
    // Handle stderr
    this.process!.stderr?.on('data', (data) => {
      console.error('[child error]', data.toString())
    })
  }
  
  private getProcessArgs(): string[] {
    if (this.runtime === 'python') {
      return [this.workerPath]
    } else {
      // node-isolated: Run TypeScript file via ts-node or direct node
      return ['-r', 'tsx/cjs', this.workerPath]
    }
  }
  
  private createTimeout(): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Worker timeout after ${this.timeout}ms`))
      }, this.timeout)
    })
  }
  
  private async cleanup() {
    if (this.process) {
      this.process.kill()
      this.process = null
    }
  }
}
```

## WorkerManager Integration

WorkerManager detects `runtime` in config and wraps handler automatically:

```typescript
// src/runtime/server/worker/adapters/bullmq.ts (extended)

export class BullMQWorkerManager implements WorkerManager {
  async registerWorker(
    queueName: string,
    jobName: string,
    handler: WorkerHandler,
    opts?: WorkerOptions
  ): Promise<void> {
    const runtime = opts?.runtime || 'node'
    
    // Wrap handler if multi-runtime
    const finalHandler = (runtime === 'python' || runtime === 'node-isolated')
      ? this.wrapChildProcessHandler(handler, runtime, opts)
      : handler
    
    // Register wrapped/original handler with BullMQ
    // (same code as before)
    let info = this.registeredWorkers.get(queueName)
    if (info) {
      info.handlers.set(jobName, finalHandler)
      return
    }
    
    // ... create Worker with dispatcher ...
  }
  
  private wrapChildProcessHandler(
    handler: WorkerHandler,
    runtime: 'python' | 'node-isolated',
    opts?: WorkerOptions
  ): WorkerHandler {
    // Get worker path from registry
    const registry = $useQueueRegistry() as any
    const workerMeta = registry.workers.find((w: any) => 
      w.queue?.name === queueName && w.flow?.step === jobName
    )
    
    if (!workerMeta?.absPath) {
      throw new Error(`Cannot find worker path for ${queueName}/${jobName}`)
    }
    
    // Create ChildProcessRunner
    const runner = new ChildProcessRunner(
      workerMeta.absPath,
      runtime,
      opts?.timeout || 300000
    )
    
    // Return wrapped handler
    return runner.createHandler()
  }
}
```

**Key Points**:
- ✅ Worker registration flow is identical for all runtimes
- ✅ WorkerManager transparently wraps multi-runtime handlers
- ✅ Same dispatcher pattern works for all handlers
- ✅ Child process execution is hidden from application code

## RPC Protocol

### Parent → Child (Execute Job)
```json
{
  "jsonrpc": "2.0",
  "method": "execute",
  "params": {
    "job": { "id": "123", "data": {...} },
    "context": {
      "flowId": "abc-123",
      "flowName": "ml-flow",
      "stepName": "train_model"
    }
  },
  "id": 1
}
```

### Child → Parent (Context Call - State)
```json
{
  "jsonrpc": "2.0",
  "method": "ctx.state.set",
  "params": {
    "key": "model_version",
    "value": "1.0"
  },
  "id": 2
}
```

### Child → Parent (Context Call - Logger)
```json
{
  "jsonrpc": "2.0",
  "method": "ctx.logger.log",
  "params": {
    "level": "info",
    "message": "Training complete",
    "metadata": { "accuracy": 0.95 }
  },
  "id": 3
}
```

### Child → Parent (Context Call - Emit)
```json
{
  "jsonrpc": "2.0",
  "method": "ctx.emit",
  "params": {
    "event": {
      "type": "emit",
      "data": {
        "name": "model.trained",
        "accuracy": 0.95
      }
    }
  },
  "id": 4
}
```

### Child → Parent (Result)
```json
{
  "jsonrpc": "2.0",
  "result": {
    "accuracy": 0.95,
    "version": "1.0"
  },
  "id": 1
}
```

## Python SDK

The Python child process receives jobs via stdin and communicates via stdout:

```python
# nuxt_queue/__init__.py
import sys
import json
import asyncio
from typing import Any, Callable, Dict

class RunContext:
    """Worker execution context with RPC to parent"""
    
    def __init__(self, rpc_client):
        self.rpc = rpc_client
        self.flowId = None
        self.flowName = None
        self.stepName = None
    
    async def _rpc_call(self, method: str, params: Dict[str, Any]) -> Any:
        """Make RPC call to parent process"""
        return await self.rpc.request(method, params)
    
    class State:
        def __init__(self, ctx):
            self.ctx = ctx
        
        async def get(self, key: str) -> Any:
            return await self.ctx._rpc_call('ctx.state.get', {'key': key})
        
        async def set(self, key: str, value: Any):
            return await self.ctx._rpc_call('ctx.state.set', {'key': key, 'value': value})
    
    class Logger:
        def __init__(self, ctx):
            self.ctx = ctx
        
        def log(self, level: str, message: str, metadata: Dict = None):
            asyncio.create_task(
                self.ctx._rpc_call('ctx.logger.log', {
                    'level': level,
                    'message': message,
                    'metadata': metadata or {}
                })
            )
        
        def info(self, message: str, metadata: Dict = None):
            self.log('info', message, metadata)
        
        def error(self, message: str, metadata: Dict = None):
            self.log('error', message, metadata)
        
        def warn(self, message: str, metadata: Dict = None):
            self.log('warn', message, metadata)
    
    async def emit(self, event: Dict[str, Any]):
        """Emit event to flow engine"""
        return await self._rpc_call('ctx.emit', {'event': event})

# RPC client and server implementation...
# (See full implementation in roadmap)

def run_worker(handler: Callable):
    """Main entry point for Python workers"""
    # Setup RPC, context, and stdin/stdout communication
    # (See full implementation in roadmap)
    pass

def define_worker(handler: Callable):
    """Decorator to define a worker"""
    return handler

def define_config(config: Dict[str, Any]):
    """Define worker configuration"""
    return config
```

### Python Worker Usage

```python
# server/queues/ml-flow/train_model.py
from nuxt_queue import define_worker, define_config, run_worker, RunContext
import asyncio

@define_worker
async def handler(job: dict, ctx: RunContext):
    ctx.logger.info('Starting training')
    
    # Your code here
    result = train_model(job['data'])
    
    await ctx.state.set('model', result)
    await ctx.emit({
        'type': 'emit',
        'data': {'name': 'model.trained'}
    })
    
    return result

config = define_config({
    'runtime': 'python',
    'concurrency': 2
})

if __name__ == '__main__':
    asyncio.run(run_worker(handler))
```

## Configuration

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  queue: {
    runtimes: {
      python: {
        enabled: true,
        command: 'python3',           // Python executable
        venv: '.venv',                // Optional virtualenv path
        timeout: 300000,              // 5 minute default timeout
      },
      'node-isolated': {
        enabled: true,
        command: 'node',
        timeout: 600000,              // 10 minute default timeout
      }
    }
  }
})
```

## Registry Integration

The registry scanner detects runtime from config and passes it to WorkerManager:

```typescript
// Registry scans Python files
{
  kind: 'py',
  name: 'train_model',
  path: '/server/queues/ml-flow/train_model.py',
  absPath: '/full/path/to/server/queues/ml-flow/train_model.py',
  worker: {
    runtime: 'python',  // ← Detected from config
    concurrency: 2,
    timeout: 300000
  },
  config: { ... }
}

// Nitro plugin registration:
const workerManager = getWorkerManager()
await workerManager.registerWorker(
  'ml-flow',              // queue
  'train_model',          // job name
  handler,                // loaded handler (Python SDK entry point)
  {
    runtime: 'python',    // ← Triggers child process wrapping
    concurrency: 2,
    timeout: 300000
  }
)

// When job is processed:
// 1. Queue picks up job (BullMQ/Memory/File)
// 2. Dispatcher routes to handler
// 3. Handler is ChildProcessRunner (wrapped)
// 4. Spawns: python3 /full/path/to/train_model.py
// 5. RPC communication for context
// 6. Collect result and complete job
```

## Benefits

✅ **Integrated Architecture**: Multi-runtime support is part of WorkerManager, not separate system  
✅ **Transparent Execution**: Application code doesn't know if handler runs in-process or child process  
✅ **Standard Queue System**: Uses BullMQ/Memory/File without modification  
✅ **Process Isolation**: Each job in own process (Python/isolated Node.js)  
✅ **Full Context**: State, logger, flow engine via RPC  
✅ **Resource Efficient**: Spawn per job, no idle processes  
✅ **Error Handling**: Process crashes don't affect other jobs  
✅ **Timeout Control**: Kill processes that run too long  
✅ **Same Events**: step.started/completed/failed work identically for all runtimes

## Use Cases

### Python Workers
- ML/AI workflows (PyTorch, TensorFlow, scikit-learn)
- Data processing (pandas, numpy)
- Scientific computing (scipy, matplotlib)
- Image processing (Pillow, OpenCV)
- Existing Python codebases

### Isolated Node.js Workers
- Heavy CPU computation (won't block worker pool)
- Memory-intensive tasks
- Unreliable 3rd party packages
- Experimental code that might crash
- Long-running operations

## Implementation Checklist

- [ ] Create `ChildProcessRunner` class
- [ ] Add RPC communication layer (json-rpc-2.0)
- [ ] Extend BullMQWorkerManager with child process wrapping
- [ ] Extend MemoryWorkerManager with child process wrapping
- [ ] Create Python SDK (nuxt_queue package)
  - [ ] RPC client/server
  - [ ] RunContext implementation
  - [ ] Worker entry point
- [ ] Update registry to detect Python files
- [ ] Update worker plugin to pass runtime to WorkerManager
- [ ] Add timeout handling
- [ ] Add error handling and cleanup
- [ ] Write tests for child process execution
- [ ] Write tests for RPC communication
- [ ] Document Python SDK usage

## Configuration

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  queue: {
    runtimes: {
      python: {
        enabled: true,
        command: 'python3',           // Python executable
        venv: '.venv',                // Optional virtualenv path
        timeout: 300000,              // 5 minute default timeout
      },
      'node-isolated': {
        enabled: true,
        command: 'node',
        timeout: 600000,              // 10 minute default timeout
      }
    }
  }
})
```

## Future Enhancements

- **Worker Pools**: Maintain pool of Python processes to avoid spawn overhead
- **Hot Reload**: Reload Python worker code without process restart
- **Binary Protocol**: Replace JSON-RPC with faster binary protocol (MessagePack)
- **Streaming**: Support streaming responses from child processes
- **Other Languages**: Go, Ruby, Rust workers using same pattern
