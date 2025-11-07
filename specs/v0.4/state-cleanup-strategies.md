# State Cleanup Strategies

## ✅ All Strategies Available

With the implementation of flow lifecycle tracking in v0.4, all cleanup strategies are now fully functional:

**Available strategies:**
- ✅ `never` - State persists indefinitely
- ✅ `immediate` - Cleans after each step (not recommended)
- ✅ `on-complete` - Cleans when flow completes (recommended) ⭐
- ✅ `ttl` - Automatic expiration via storage (Redis)

**Recommendation:** Use `on-complete` for production flows to automatically clean up state when flows finish.

---

## Overview

Nuxt Queue provides automatic cleanup of flow state to prevent memory/storage bloat. You can configure the cleanup strategy based on your needs.

## Configuration

```typescript
export default defineNuxtConfig({
  queue: {
    state: {
      cleanup: {
        strategy: 'on-complete', // 'never' | 'immediate' | 'on-complete' | 'ttl'
        ttlMs: 3600000, // Optional: TTL in milliseconds (for 'ttl' strategy)
      }
    }
  }
})
```

## Strategies

### `never` (default)

State persists indefinitely until manually deleted.

**Use when:**
- You need to inspect state after flow completion
- Debugging flows
- Long-running flows that need state history
- Manual cleanup is preferred

**Pros:**
- Full state history preserved
- Easy debugging and inspection
- No data loss

**Cons:**
- Storage can grow unbounded
- Requires manual cleanup

```typescript
state: {
  cleanup: {
    strategy: 'never'
  }
}
```

### `on-complete` (recommended)

State is cleaned up when a flow completes (either successfully or fails).

**Use when:**
- State is only needed during flow execution
- You want automatic cleanup
- Storage optimization is important
- Flow completion is well-defined

**Pros:**
- Automatic cleanup
- Storage efficient
- State available during entire flow
- Handles both success and failure

**Cons:**
- State lost after flow completion
- Cannot inspect state post-execution

```typescript
state: {
  cleanup: {
    strategy: 'on-complete'
  }
}
```

**How it works:**
- Listens for `flow.completed` and `flow.failed` events
- Deletes all state keys for that flow ID
- Cleanup happens in background (non-blocking)

### `immediate`

State is cleaned up immediately after each step completes.

**Use when:**
- Steps are independent
- State doesn't need to persist across steps
- Maximum storage efficiency needed
- Each step is stateless

**Pros:**
- Minimal storage usage
- Fastest cleanup
- No state accumulation

**Cons:**
- State not available for subsequent steps
- Cannot share state between steps
- Not suitable for most flows

```typescript
state: {
  cleanup: {
    strategy: 'immediate'
  }
}
```

⚠️ **Warning:** This strategy cleans up after EACH STEP, not after the flow. Use with caution!

### `ttl`

State expires automatically based on TTL (Time To Live) set by the storage provider.

**Use when:**
- Using Redis or other TTL-capable storage
- Want time-based expiration
- Need state to persist for specific duration
- Don't want to rely on flow completion events

**Pros:**
- Automatic expiration
- Storage-level feature
- Configurable duration
- Works even if flow never completes

**Cons:**
- Requires TTL-capable storage (Redis, PostgreSQL)
- State may expire before flow completes
- Less precise than event-based cleanup

```typescript
state: {
  cleanup: {
    strategy: 'ttl',
    ttlMs: 3600000 // 1 hour
  }
}
```

**Note:** TTL is set when state is created. Some storage adapters may not support TTL.

## Comparison Table

| Strategy | Cleanup Trigger | State Lifetime | Best For | Storage Impact |
|----------|----------------|----------------|----------|----------------|
| `never` | Manual | Indefinite | Debugging, inspection | High |
| `on-complete` | Flow completion | Entire flow | Production flows | Low |
| `immediate` | Step completion | Single step | Stateless steps | Minimal |
| `ttl` | Time-based | Fixed duration | Time-bounded flows | Medium |

## Recommendations

### Development
```typescript
state: {
  cleanup: { strategy: 'never' }
}
```
Keep state for debugging and inspection.

### Production
```typescript
state: {
  cleanup: { strategy: 'on-complete' }
}
```
Automatic cleanup while maintaining state throughout flow execution.

### High-Volume Production
```typescript
state: {
  cleanup: {
    strategy: 'ttl',
    ttlMs: 3600000 // 1 hour
  }
}
```
Time-based cleanup with Redis/PostgreSQL for guaranteed expiration.

## Debugging

Enable debug logging to see cleanup in action:

```bash
NQ_DEBUG_STATE=1 yarn dev
```

You'll see logs like:
```
[state-cleanup] Plugin initialized with strategy: on-complete
[state-cleanup] Cleaned up 5 state keys for flow abc-123
```

## Implementation Details

- **Plugin-based**: Cleanup is handled by `state-cleanup.ts` plugin
- **Event-driven**: Listens to `flow.completed` and `flow.failed` events
- **Non-blocking**: Cleanup runs asynchronously
- **Error handling**: Failures are logged but don't affect flow execution
- **Scope-aware**: Only cleans up state for the specific flow

## Migration from Old Behavior

Previously, `on-complete` cleaned up after EACH STEP. This has been fixed:

**Old (incorrect):**
```
Step 1 completes → cleanup all state
Step 2 starts → no state available ❌
```

**New (correct):**
```
Step 1 completes → state persists
Step 2 starts → state available ✓
All steps complete → cleanup all state
```

If you were relying on the old behavior, use `strategy: 'immediate'` instead.
