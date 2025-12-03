# Store Adapter Update Strategy

## Problem Analysis

The recent bugs with `await.registered` events revealed systematic issues with how we update index metadata:

### Issues

1. **Dot Notation String Keys** (`['awaitingSteps.${stepName}.status']`)
   - ❌ NOT atomic in Redis - requires read-modify-write
   - ❌ Incompatible with `expandDotNotation` logic
   - ❌ Causes silent failures with Redis adapter

2. **Nested Object Updates** (`{ awaitingSteps: { [stepName]: { status: 'awaiting' } } }`)
   - ✅ Works with `expandDotNotation` / `serializeHashFields`
   - ✅ Compatible across all adapters
   - ⚠️ NOT atomic in Redis - full read-modify-write with optimistic locking
   - ⚠️ Can overwrite sibling fields if not careful

3. **Direct Field Updates** (what we should use for atomic operations)
   - ✅ Atomic in Redis using HINCRBY
   - ✅ Atomic in Memory using locks
   - ✅ Best for counters (stats)
   - ❌ Limited to top-level or flat fields

## Recommended Strategy

### For Counters (Stats) - Use `index.increment()`

**Always atomic**, works across all adapters:

```typescript
// ✅ CORRECT - Atomic increment
await store.index.increment(indexKey, runId, 'stats.running', 1)
await store.index.increment(indexKey, runId, 'stats.awaiting', -1)
```

**Implementation:**
- **Redis**: Uses `HINCRBY` on flattened field `stats.running`
- **Memory**: Uses lock + direct increment
- **File**: Inherits from memory

### For Complex Objects - Use `index.updateWithRetry()`

**Uses optimistic locking**, safe but not atomic:

```typescript
// ✅ CORRECT - Nested objects with retry
await store.index.updateWithRetry(indexKey, runId, {
  awaitingSteps: {
    [stepName]: {
      status: 'awaiting',
      awaitType,
      config,
      registeredAt: Date.now(),
    },
  },
})
```

**How it works:**
1. Redis: Reads current version → merges → writes with version check
2. Memory: Uses `defu` deep merge with lock
3. Retries on version conflict (up to 3 times)

**Important Rules:**
- ⚠️ Updates are merged, not replaced
- ⚠️ Sibling fields preserved automatically
- ⚠️ Use for infrequent updates (awaits, state changes)
- ⚠️ NOT for high-frequency counters

### For Simple Fields - Use `index.update()`

**Single attempt, no retry**:

```typescript
// ✅ CORRECT - Simple field updates
await store.index.update(indexKey, runId, {
  status: 'running',
  startedAt: Date.now(),
})
```

## What NOT to Do

### ❌ NEVER Use Dot Notation String Keys

```typescript
// ❌ WRONG - Dot notation keys
await store.index.update(indexKey, runId, {
  [`awaitingSteps.${stepName}.status`]: 'awaiting',  // FAILS with Redis!
  [`stats.running`]: 5,  // FAILS with Redis!
})
```

**Why it fails:**
- `expandDotNotation()` expects object `{ stats: { running: 5 } }`
- String keys bypass the expansion logic
- Redis stores as literal key name, not nested structure

### ❌ NEVER Use updateWithRetry() for Counters

```typescript
// ❌ WRONG - Race condition!
const stats = await store.index.get(indexKey, runId)
await store.index.updateWithRetry(indexKey, runId, {
  stats: {
    running: stats.metadata.stats.running + 1,  // RACE CONDITION!
  },
})
```

**Why it fails:**
- Multiple concurrent increments will conflict
- Retry logic adds latency
- Use `index.increment()` instead

## Implementation Guidelines

### Pattern 1: Stats Tracking

```typescript
// Start flow
await store.index.increment(statsKey, flowName, 'stats.running', 1)

// Complete flow
await store.index.increment(statsKey, flowName, 'stats.running', -1)
await store.index.increment(statsKey, flowName, 'stats.success', 1)

// Stall flow
const previousStatus = flowRun.metadata.status
await store.index.increment(
  statsKey, 
  flowName, 
  `stats.${previousStatus}`,  // ⚠️ NOTE: This is a template string, produces 'stats.running'
  -1
)
```

### Pattern 2: Await Registration

```typescript
// Register await
await store.index.updateWithRetry(indexKey, runId, {
  awaitingSteps: {
    [stepName]: {
      status: 'awaiting',
      awaitType,
      position,
      config,
      registeredAt: Date.now(),
      timeoutAt,
    },
  },
})

// Decrement running, increment awaiting atomically (two operations)
await store.index.increment(statsKey, flowName, 'stats.running', -1)
await store.index.increment(statsKey, flowName, 'stats.awaiting', 1)
```

### Pattern 3: Emit Tracking

```typescript
// Track emitted event
await store.index.updateWithRetry(indexKey, runId, {
  emittedEvents: {
    [eventName]: Date.now(),
  },
})
```

## Validation

To prevent mistakes, we should add runtime validation in store adapters.

### Detect Dot Notation Misuse

```typescript
function validateUpdatePayload(payload: Record<string, any>, method: string): void {
  for (const key of Object.keys(payload)) {
    if (key.includes('.') && key !== 'version') {
      console.warn(
        `[StoreAdapter] Invalid update payload in ${method}():`,
        `Dot notation key "${key}" detected.`,
        `Use nested objects instead:`,
        `{ ${key.split('.')[0]}: { ${key.split('.')[1]}: value } }`
      )
      throw new Error(
        `Invalid index update: dot notation keys not supported. Use nested objects for "${key}".`
      )
    }
  }
}
```

### Detect Counter Misuse

```typescript
function detectCounterMisuse(payload: Record<string, any>, method: string): void {
  function checkNested(obj: any, path: string[] = []): void {
    for (const [key, value] of Object.entries(obj)) {
      const currentPath = [...path, key]
      
      // Check if it looks like a counter field
      if (
        typeof value === 'number' &&
        (key.includes('count') || key.includes('total') || 
         currentPath.some(p => p === 'stats'))
      ) {
        console.warn(
          `[StoreAdapter] Potential counter misuse in ${method}():`,
          `Field "${currentPath.join('.')}" is numeric.`,
          `Consider using index.increment() for atomic updates.`
        )
      }
      
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        checkNested(value, currentPath)
      }
    }
  }
  
  checkNested(payload)
}
```

## Performance Considerations

### Redis Adapter

1. **`index.increment()`** - Single `HINCRBY` command - **O(1)** ✅
2. **`index.updateWithRetry()`** - `HGETALL` + `EVAL` with retry loop - **O(n * retries)** ⚠️

### Memory Adapter

1. **`index.increment()`** - Lock + direct modification - **O(1)** ✅
2. **`index.updateWithRetry()`** - Lock + deep merge with `defu` - **O(n)** ⚠️

### Recommendations

- Use `increment()` for all stat counters
- Use `updateWithRetry()` for complex state (awaits, metadata)
- Keep complex objects small (< 10 fields per nested level)
- Avoid deeply nested structures (max 3 levels)

## Horizontal Scaling

### Current State

- **Optimistic Locking** via version field prevents lost updates
- **Retry Logic** handles contention automatically
- **Stats Counters** are atomic (no version conflicts)

### Limitations

- No distributed locks across Redis instances
- Version conflicts increase with concurrency
- Retry backoff can add latency under load

### Future Improvements

1. **Redis Lua Scripts** for multi-field atomic updates
2. **Redlock** for distributed locking if needed
3. **Batch Operations** to reduce round trips
4. **Event Sourcing** for audit trail and replay

## Migration Path

Current codebase uses nested objects everywhere now. This works fine with current implementation.

If we need better atomicity in future:

1. Keep nested objects for complex state
2. Extract counters to use `increment()` explicitly
3. Add Lua scripts for multi-field atomic updates in Redis
4. Add validation to catch misuse early
