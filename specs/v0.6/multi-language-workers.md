# Multi-Language Workers with Child Process Manager

> **Version**: v0.6.0  
> **Status**: 📋 Planning  
> **Last Updated**: 2025-10-30

## Goal

Enable Python and isolated Node.js workers via child processes, using standard queue management.

## Architecture

Instead of maintaining a separate process pool, we spawn child processes per job execution. This provides:
- **Process Isolation**: Each job runs in its own process
- **Standard Queue Management**: Uses existing BullMQ/PgBoss without changes
- **Multi-Language**: Supports Python, Node.js, or any executable
- **Resource Efficiency**: Spawn on demand, cleanup after completion
- **Simpler Design**: No separate process pool to manage

```
┌──────────────────────────────────────────────────────────────┐
│                   BullMQ / PgBoss Queue                      │
│              (Standard Node.js Queue System)                 │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         │ Job Picked Up
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│              Worker Wrapper (Node.js Parent)                 │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │  Process Manager                                   │    │
│  │  - Spawn child process (Python/Node.js)           │    │
│  │  - Setup RPC communication                         │    │
│  │  - Forward context (state, logger, emit)          │    │
│  │  - Handle timeouts & errors                       │    │
│  │  - Collect result                                  │    │
│  │  - Cleanup process                                 │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         │ Spawn & RPC
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                   Child Process                              │
│                                                              │
│  ┌──────────────┐     OR      ┌──────────────┐            │
│  │   Python     │              │   Node.js    │            │
│  │   Worker     │              │   Worker     │            │
│  │              │              │  (isolated)  │            │
│  └──────────────┘              └──────────────┘            │
│                                                              │
│  - Receives job via RPC                                     │
│  - Has full context (state, logger, emit)                   │
│  - Executes worker code                                     │
│  - Returns result via RPC                                   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

## Worker Registration

Workers are registered normally, with a `runtime` field indicating execution environment:

### Python Worker

```python
# server/queues/ml-flow/train_model.py
from nuxt_queue import define_worker, define_config, RunContext

async def handler(job: dict, ctx: RunContext):
    """Train ML model with data from previous step"""
    data = job['data']
    
    # Full context support via RPC
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
    'runtime': 'python',              # Indicates Python child process
    'concurrency': 2,
    'flow': {
        'role': 'step',
        'subscribes': ['data.prepared'],
        'emits': ['model.trained']
    }
})
```

### Isolated Node.js Worker

Runs in child process:

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
  runtime: 'node-isolated',           // Run in child process
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

Runs in worker pool:

```typescript
// server/queues/tasks/send-email.ts
export default defineQueueWorker(async (job, ctx) => {
  await sendEmail(job.data)
  return { sent: true }
})

export const config = defineQueueConfig({
  // No runtime specified = runs in standard worker pool
  concurrency: 10
})
```

## Worker Wrapper Implementation

The wrapper manages child process lifecycle:

```typescript
// src/runtime/server/worker/childProcessRunner.ts
import { spawn } from 'child_process'
import { JSONRPCServer, JSONRPCClient } from 'json-rpc-2.0'

export class ChildProcessRunner {
  private process: ChildProcess | null = null
  private rpcServer = new JSONRPCServer()
  private rpcClient = new JSONRPCClient((request) => {
    // Send RPC request to child process
    this.process?.stdin?.write(JSON.stringify(request) + '\n')
  })
  
  constructor(
    private workerPath: string,
    private runtime: 'python' | 'node-isolated',
    private context: WorkerContext
  ) {
    this.setupRPCMethods()
  }
  
  private setupRPCMethods() {
    // Child process can call these via RPC
    this.rpcServer.addMethod('ctx.state.get', async (params) => {
      return await this.context.state.get(params.key)
    })
    
    this.rpcServer.addMethod('ctx.state.set', async (params) => {
      return await this.context.state.set(params.key, params.value)
    })
    
    this.rpcServer.addMethod('ctx.logger.log', async (params) => {
      this.context.logger.log(params.level, params.message, params.metadata)
    })
    
    this.rpcServer.addMethod('ctx.emit', async (params) => {
      return await this.context.emit(params.event)
    })
  }
  
  async execute(job: Job): Promise<any> {
    // Spawn child process
    this.process = spawn(
      this.runtime === 'python' ? 'python3' : 'node',
      [
        this.runtime === 'python' 
          ? this.workerPath 
          : '-e', `require('${this.workerPath}').default`
      ],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          NUXT_QUEUE_CHILD_PROCESS: '1'
        }
      }
    )
    
    // Setup RPC communication
    this.process.stdout?.on('data', (data) => {
      const lines = data.toString().split('\n')
      for (const line of lines) {
        if (!line.trim()) continue
        
        try {
          const message = JSON.parse(line)
          
          // Handle RPC request from child
          if (message.method) {
            this.rpcServer.receive(message).then((response) => {
              if (response) {
                this.process?.stdin?.write(JSON.stringify(response) + '\n')
              }
            })
          }
          // Handle RPC response to parent
          else if (message.result !== undefined || message.error) {
            this.rpcClient.receive(message)
          }
        } catch (e) {
          // Not JSON, might be regular output
          console.log('[child]', line)
        }
      }
    })
    
    this.process.stderr?.on('data', (data) => {
      console.error('[child error]', data.toString())
    })
    
    // Send job to child process via RPC
    const result = await this.rpcClient.request('execute', {
      job: job.data,
      context: {
        flowId: this.context.flowId,
        flowName: this.context.flowName,
        stepName: this.context.stepName
      }
    })
    
    // Cleanup
    await this.cleanup()
    
    return result
  }
  
  private async cleanup() {
    if (this.process) {
      this.process.kill()
      this.process = null
    }
  }
}
```

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

The registry scanner detects the runtime and registers accordingly:

```typescript
// Registry scans Python files
{
  kind: 'py',
  name: 'train_model',
  path: '/server/queues/ml-flow/train_model.py',
  runtime: 'python',
  config: {
    concurrency: 2,
    timeout: 300000,
    flow: { ... }
  }
}

// When job is processed:
// 1. BullMQ picks up job
// 2. Worker wrapper sees runtime: 'python'
// 3. Spawns child process: python3 train_model.py
// 4. RPC communication for context
// 5. Collect result and complete job
```

## Benefits

✅ **Standard Queue System**: Uses BullMQ/PgBoss without modification  
✅ **Process Isolation**: Each job in own process  
✅ **Multi-Language**: Python, Node.js, or any runtime  
✅ **Resource Efficient**: Spawn per job, no idle processes  
✅ **Full Context**: State, logger, emit via RPC  
✅ **Simple Design**: No separate process pool  
✅ **Works with Nitro Tasks**: Can spawn isolated Node.js processes  
✅ **Error Handling**: Process crashes don't affect other jobs  
✅ **Timeout Control**: Kill processes that run too long

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
