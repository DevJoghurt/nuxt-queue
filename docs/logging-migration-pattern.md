# Logging Migration Pattern

This document shows the pattern for migrating from `console.*` to `useServerLogger` in server files.

## Pattern

### 1. Add import and create logger

```typescript
// At the top of the file, after other imports
import { useServerLogger } from '../utils/useServerLogger'

const logger = useServerLogger('scope-name')
```

### 2. Replace console calls

| Before | After |
|--------|-------|
| `console.log('[scope] message', data)` | `logger.debug('Message', data)` or `logger.info('Message', data)` |
| `console.info('[scope] message', data)` | `logger.info('Message', data)` |
| `console.warn('[scope] message', data)` | `logger.warn('Message', data)` |
| `console.error('[scope] message', data)` | `logger.error('Message', { error: data })` |

### 3. Remove scope prefix from message

The scope is automatically added by the logger, so remove `[scope]` prefixes:

```typescript
// Before
console.log('[flow-wiring] triggered step:', { stepName, runId })

// After
logger.debug('Triggered step', { stepName, runId })
```

### 4. Remove environment checks

Debug logging is now controlled by configuration:

```typescript
// Before
if (process.env.NQ_DEBUG_EVENTS === '1') {
  console.log('[scope] debug info', data)
}

// After  
logger.debug('Debug info', data)
```

## Scope Names by File

| File Path | Scope Name |
|-----------|------------|
| `events/wiring/flowWiring.ts` | `flow-wiring` |
| `events/eventStoreFactory.ts` | `event-store-factory` |
| `utils/useEventStore.ts` | `event-store` |
| `utils/useEventManager.ts` | `event-manager` |
| `utils/useFlowEngine.ts` | `flow-engine` |
| `plugins/state-cleanup.ts` | `state-cleanup` |
| `plugins/queue-management.ts` | `queue-management` |
| `plugins/flow-management.ts` | `flow-lifecycle` |
| `plugins/00.ws-lifecycle.ts` | `ws-lifecycle` |
| `events/adapters/redis/redisAdapter.ts` | `redis-adapter` |
| `events/adapters/redis/redisPubSubGateway.ts` | `redis-pubsub` |
| `worker/adapter.ts` | `worker-adapter` |
| `worker/runner/node.ts` | `worker-runner` |
| `queue/adapters/bullmq.ts` | `bullmq-adapter` |
| `api/_flows/ws.ts` | `flows-ws` |
| `api/_queues/ws.ts` | `queues-ws` |
| `api/_flows/[name]/runs.get.ts` | `flows-api` |

## Examples

### Plugin Example

```typescript
// Before
import { defineNitroPlugin } from '#imports'

export default defineNitroPlugin(() => {
  console.info('[queues plugin] Closing existing queue provider...')
})

// After
import { defineNitroPlugin } from '#imports'
import { useServerLogger } from '../utils/useServerLogger'

const logger = useServerLogger('queue-management')

export default defineNitroPlugin(() => {
  logger.info('Closing existing queue provider')
})
```

### Worker Example

```typescript
// Before
console.error(`[worker] Job failed: ${job.name}`, {
  jobId: job.id,
  error: err.message
})

// After
const logger = useServerLogger('worker-runner')

logger.error('Job failed', {
  jobName: job.name,
  jobId: job.id,
  error: err.message
})
```

### API Route Example

```typescript
// Before
export default defineEventHandler(async (event) => {
  try {
    // ... logic
  } catch (err) {
    console.error('[flows/runs] error:', err)
  }
})

// After
import { useServerLogger } from '../../utils/useServerLogger'

const logger = useServerLogger('flows-api')

export default defineEventHandler(async (event) => {
  try {
    // ... logic
  } catch (err) {
    logger.error('Failed to fetch runs', { error: err })
  }
})
```

## Files Completed

✅ `events/wiring/flowWiring.ts`
✅ `events/eventStoreFactory.ts`
✅ `utils/useEventStore.ts`
✅ `utils/useEventManager.ts`
✅ `utils/useFlowEngine.ts`
✅ `plugins/state-cleanup.ts`

## Files Remaining

See the list above for scope names to use when updating:

- `plugins/queue-management.ts`
- `plugins/flow-management.ts`
- `plugins/00.ws-lifecycle.ts`
- `events/adapters/redis/redisAdapter.ts`
- `events/adapters/redis/redisPubSubGateway.ts`
- `worker/adapter.ts`
- `worker/runner/node.ts`
- `queue/adapters/bullmq.ts`
- `api/_flows/ws.ts`
- `api/_queues/ws.ts`
- `api/_flows/[name]/runs.get.ts`
- `api/_flows/[name]/clear-history.delete.ts`
- `api/_queues/index.get.ts`
