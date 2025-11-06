# Server Logging

The `useServerLogger` utility provides a consistent, configurable logging system for all server-side code in the nuxt-queue module. It uses [consola](https://github.com/unjs/consola) for beautiful, styled console output.

## Features

- **Styled Output**: Powered by consola for colored, formatted logs with icons
- **Scoped Logging**: Each logger has a namespace/scope for easy filtering
- **Log Levels**: Support for `debug`, `info`, `warn`, `error`, and `silent`
- **Selective Debug**: Enable debug logging for specific scopes only
- **Environment Config**: Configure via runtime config or environment variables
- **Structured Context**: Attach metadata objects to log messages
- **Performance**: Cached logger instances per scope

## Basic Usage

```typescript
import { useServerLogger } from '../utils/useServerLogger'

const logger = useServerLogger('my-module')

logger.debug('Detailed information', { userId: 123, action: 'fetch' })
logger.info('Operation completed successfully')
logger.warn('Potential issue detected', { retries: 3 })
logger.error('Operation failed', { error: err.message, stack: err.stack })

// Access raw consola instance for advanced features
logger.consola.box('Important Message!')
```

## Configuration

### Runtime Config (nuxt.config.ts)

```typescript
export default defineNuxtConfig({
  queue: {
    debug: {
      // Global log level: 'debug' | 'info' | 'warn' | 'error' | 'silent'
      level: 'info',
      
      // Enable debug logging for specific scopes
      flow_wiring: true,
      event_manager: true,
    }
  }
})
```

### Environment Variables

```bash
# Set global log level
NQ_DEBUG_LEVEL=debug

# Enable debug logging for specific scopes
NQ_DEBUG_FLOW_WIRING=1
NQ_DEBUG_EVENT_MANAGER=1
NQ_DEBUG_QUEUE_MANAGEMENT=1
```

## Log Levels

| Level   | Priority | Description                                  |
|---------|----------|----------------------------------------------|
| debug   | 0        | Detailed diagnostic information              |
| info    | 1        | General informational messages (default)     |
| warn    | 2        | Warning messages for potential issues        |
| error   | 3        | Error messages for failures                  |
| silent  | ∞        | Suppress all logging                         |

## Scope Names

The scope parameter is automatically normalized to a key format:
- `'flow-wiring'` → `flow_wiring`
- `'event.manager'` → `event_manager`
- `'Queue/Management'` → `queue_management`

This ensures consistent matching between runtime config and environment variables.

## Examples

### Flow Orchestration

```typescript
import { useServerLogger } from '../utils/useServerLogger'

const logger = useServerLogger('flow-wiring')

function triggerStep(stepName: string, runId: string) {
  logger.debug('Triggering step', { stepName, runId })
  
  try {
    // ... step logic
    logger.info('Step completed', { stepName, runId, duration: 150 })
  } catch (err) {
    logger.error('Step failed', { stepName, runId, error: err.message })
  }
}
```

### Event Processing

```typescript
import { useServerLogger } from '../utils/useServerLogger'

const logger = useServerLogger('event-manager')

function publishEvent(event: EventRecord) {
  if (logger.isEnabled('debug')) {
    logger.debug('Publishing event', { 
      type: event.type, 
      runId: event.runId,
      timestamp: event.ts 
    })
  }
  
  // ... publish logic
}
```

### Worker Execution

```typescript
import { useServerLogger } from '../utils/useServerLogger'

const logger = useServerLogger('worker-runner')

async function executeJob(job: Job) {
  logger.info('Job started', { jobId: job.id, queue: job.queueName })
  
  try {
    const result = await job.fn(job.data)
    logger.info('Job completed', { jobId: job.id, duration: job.finishedOn - job.processedOn })
    return result
  } catch (err) {
    logger.error('Job failed', { 
      jobId: job.id, 
      error: err.message,
      attempt: job.attemptsMade 
    })
    throw err
  }
}
```

## Best Practices

1. **Use Appropriate Levels**
   - `debug`: Detailed execution flow, variable values, internal state
   - `info`: Important milestones, completed operations, successful state changes
   - `warn`: Recoverable issues, retries, degraded performance
   - `error`: Failures, exceptions, data loss

2. **Include Relevant Context**
   ```typescript
   // Good: Structured context
   logger.error('Failed to process job', { jobId, queueName, error: err.message })
   
   // Avoid: Concatenated strings
   logger.error(`Failed to process job ${jobId}: ${err.message}`)
   ```

3. **Check Level Before Expensive Operations**
   ```typescript
   if (logger.isEnabled('debug')) {
     const expensiveData = computeComplexState()
     logger.debug('Current state', expensiveData)
   }
   ```

4. **Use Consistent Scope Names**
   - Use kebab-case for readability: `'flow-wiring'`, `'event-manager'`
   - Match module/file structure: `'queue/management'` → `queue_management`

5. **Don't Log Sensitive Data**
   ```typescript
   // Bad: Logging passwords
   logger.debug('User login', { username, password })
   
   // Good: Redact sensitive fields
   logger.debug('User login', { username, passwordHash: '***' })
   ```

## Migration from console.*

Replace direct console calls with the styled logger:

```typescript
// Before
console.log('[flow-wiring] triggered step:', { stepName, runId })
console.warn('[flow-wiring] retry attempt:', { attempt: 3 })
console.error('[flow-wiring] failed:', err)

// After
const logger = useServerLogger('flow-wiring')
logger.debug('Triggered step', { stepName, runId })
logger.warn('Retry attempt', { attempt: 3 })
logger.error('Operation failed', { error: err.message })
```

**Benefits of migration:**
- ✨ Colored, styled output with icons
- 🎯 Configurable log levels (suppress debug in production)
- 🏷️ Tagged scope for easy filtering
- 📊 Structured context data
- ⚡ Better performance (cached instances)

## Output Format

Log messages are beautifully formatted by consola with colors, icons, and timestamps:

```
ℹ [flow-wiring] Triggered step { stepName: 'process', runId: 'abc-123' }
✔ [event-manager] Event published { type: 'step.completed', runId: 'abc-123' }
⚠ [worker-runner] Retry attempt { attempt: 3, maxAttempts: 5 }
✖ [queue-management] Job failed { jobId: '789', error: 'Connection timeout' }
```

### Advanced Consola Features

You can access the underlying consola instance for advanced formatting:

```typescript
const logger = useServerLogger('my-module')

// Box messages
logger.consola.box('🚀 Flow Started')

// Success message
logger.consola.success('All steps completed')

// Start/Fail patterns
logger.consola.start('Processing...')
logger.consola.fail('Process failed')

// Tables and more
logger.consola.table([
  { step: 'first', status: 'completed' },
  { step: 'second', status: 'running' },
])
```
