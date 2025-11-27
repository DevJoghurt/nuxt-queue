# Prefix Standardization

## Overview

Unified all prefixes across the codebase to use `nvent` instead of the mixed `nq`, `nvent`, and no-prefix patterns.

## Problem

Previously, the codebase had inconsistent prefix usage:
- Config defaults: `nq`
- Scheduler: `nvent:scheduler`
- Stream topics: `stream:flow:...` (no prefix)
- Store subjects: `nq:flow:...`
- Adapter modules: `nq`
- BullMQ (queue-redis): Uses its own prefix

This caused confusion and made it difficult to identify nvent-related keys in Redis or other backends.

## Solution

**All prefixes now default to `nvent`** to match the module name.

### Changes Made

#### 1. Core Config (`packages/nvent/src/runtime/config/index.ts`)
```typescript
// Before
queue: { prefix: 'nq' }
stream: { prefix: 'nq' }
store: { prefix: 'nq' }

// After
queue: { prefix: 'nvent' }
stream: { prefix: 'nvent' }
store: { prefix: 'nvent' }
```

#### 2. Stream Topics (`packages/nvent/src/runtime/nitro/utils/useStreamTopics.ts`)
- **Changed from hardcoded prefixes to config-based**
- Now reads `config.nvent.store.prefix` and applies it to all patterns

```typescript
// Before
flowRun: (runId: string) => `nq:flow:${runId}`
flowEvents: (runId: string) => `stream:flow:events:${runId}`

// After (with default 'nvent' prefix)
flowRun: (runId: string) => `nvent:flow:${runId}`
flowEvents: (runId: string) => `nvent:stream:flow:events:${runId}`
```

#### 3. Scheduler (`packages/nvent/src/runtime/scheduler/index.ts`)
- **Changed to use config prefix** instead of hardcoded `nvent:scheduler`
- Now uses `${config.nvent.store.prefix}:scheduler`

```typescript
// Before
keyPrefix: 'nvent:scheduler'

// After
const prefix = config.nvent.store.prefix || 'nvent'
keyPrefix: `${prefix}:scheduler`
```

#### 4. Adapter Modules
Updated all adapter module defaults and fallbacks:

**Stream Redis** (`packages/adapter-stream-redis/src/module.ts`):
```typescript
// Before
defaults: { prefix: 'nq' }

// After
defaults: { prefix: 'nvent' }
```

**Store Redis** (`packages/adapter-store-redis/src/module.ts`):
```typescript
// Before
defaults: { prefix: 'nq' }

// After
defaults: { prefix: 'nvent' }
```

**Queue Redis** (`packages/adapter-queue-redis/src/runtime/adapter.ts`):
```typescript
// Before
prefix: nventConfig.queue?.prefix || 'nq'

// After
prefix: nventConfig.queue?.prefix || 'nvent'
```

#### 5. Playground Config (`playground/nuxt.config.ts`)
```typescript
// Before
queue: { prefix: 'nq' }
stream: { prefix: 'nq' }
store: { prefix: 'nq' }

// After
queue: { prefix: 'nvent' }
stream: { prefix: 'nvent' }
store: { prefix: 'nvent' }
```

#### 6. Tests
- Updated `test/unit/function-definitions.test.ts`
- Updated `test/e2e/store.test.ts`

## Key Patterns

### Store Subjects (Persistent Storage)
All stored in backend (Redis/Postgres/File) with prefix:

```
{prefix}:flow:{runId}              → Event stream for flow run
{prefix}:flows:{flowName}          → Flow run index
{prefix}:flows                     → Flow metadata index
{prefix}:trigger:{triggerName}     → Trigger event stream
{prefix}:triggers                  → Trigger index
{prefix}:scheduler:locks           → Scheduler locks
{prefix}:scheduler:jobs:{jobId}    → Scheduler job configs
{prefix}:scheduler:stats:{jobId}   → Scheduler job stats
```

### Stream Topics (Pub/Sub Channels)
All used for real-time WebSocket/SSE updates:

```
{prefix}:stream:flow:events:{runId}           → Flow event updates
{prefix}:stream:flow:stats                    → Flow stats updates
{prefix}:stream:trigger:events:{triggerName}  → Trigger event updates
{prefix}:stream:trigger:stats                 → Trigger stats updates
```

**Design Note:** The prefix is included in `useStreamTopics()` return values, making it the single source of truth for all naming. StreamAdapter implementations use topic names as-is without adding additional prefixes. This ensures consistency with `StoreSubjects` which also return fully prefixed keys.

### Queue Keys (BullMQ)
BullMQ uses its own prefix internally:

```
{prefix}:{queueName}:*     → BullMQ keys (managed by Bull)
```

## Configuration

Users can override the prefix in their `nuxt.config.ts`:

```typescript
export default defineNuxtConfig({
  nvent: {
    // Set custom prefix for all adapters
    queue: { prefix: 'myapp' },
    stream: { prefix: 'myapp' },
    store: { prefix: 'myapp' },
  }
})
```

**Note:** It's recommended to use the same prefix for all three adapters for consistency.

## Migration Guide

### For Existing Installations

If you have an existing installation with data stored under the `nq` prefix:

#### Option 1: Keep Old Prefix (Recommended)
```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  nvent: {
    queue: { prefix: 'nq' },
    stream: { prefix: 'nq' },
    store: { prefix: 'nq' },
  }
})
```

#### Option 2: Migrate Data
If using Redis, rename keys:

```bash
# Redis CLI
redis-cli --scan --pattern "nq:*" | xargs -L 1 -I {} redis-cli RENAME {} "nvent:{}"
```

**⚠️ Warning:** Test migration in staging first. Ensure no active jobs during migration.

### For New Installations

No action needed! The new `nvent` prefix is used by default.

## Benefits

1. **Consistency**: All nvent-related keys use the same prefix pattern
2. **Clarity**: Easy to identify nvent data in shared Redis/Postgres instances
3. **Branding**: Prefix matches the module name (nvent)
4. **Configurability**: Single config point for all adapter prefixes
5. **Namespace Isolation**: Clean separation from other applications

## Redis Key Example

With the default `nvent` prefix, a typical Redis instance will have:

```
nvent:flow:abc123                          → Flow event stream
nvent:flows:sendEmail                      → Flow run index
nvent:flows                                → Flow metadata
nvent:trigger:user.created                 → Trigger events
nvent:triggers                             → Trigger index
nvent:scheduler:locks                      → Scheduler locks
nvent:scheduler:jobs:stall-detection       → Job config
nvent:scheduler:stats:stall-detection      → Job stats
nvent:stream:flow:events:abc123            → Pub/sub topic
nvent:emails:*                             → Queue keys (BullMQ)
```

## Breaking Changes

### v0.4.5 → v0.5.0

**Default prefix changed from `nq` to `nvent`**

**Impact:**
- New installations: No impact
- Existing installations: Add explicit `prefix: 'nq'` config to maintain compatibility

**Migration:**
```typescript
// Add this to maintain compatibility
export default defineNuxtConfig({
  nvent: {
    queue: { prefix: 'nq' },
    stream: { prefix: 'nq' },
    store: { prefix: 'nq' },
  }
})
```

## Testing

All tests updated to use new prefix:
- ✅ Unit tests passing
- ✅ E2E tests passing
- ✅ Build successful
- ✅ No TypeScript errors

## Future Improvements

1. **Prefix validation**: Warn if different prefixes used for queue/stream/store
2. **Migration CLI**: Add command to rename keys in production
3. **Multi-tenancy**: Support multiple prefixes for different tenants
