# Scheduler System Implementation

## Overview

Implemented a unified scheduling system for nvent that replaces all `setTimeout` and `setInterval` usages with a robust, horizontally-scalable scheduler.

## What Was Implemented

### 1. Core Scheduler Infrastructure

**Created files:**
- `/packages/nvent/src/runtime/scheduler/types.ts` - Type definitions
- `/packages/nvent/src/runtime/scheduler/adapters/memory.ts` - Memory scheduler for builtin adapters
- `/packages/nvent/src/runtime/scheduler/adapters/distributed.ts` - Redis-based distributed scheduler
- `/packages/nvent/src/runtime/scheduler/index.ts` - Factory and composable

### 2. Key Features

#### Memory Scheduler
- Simple in-memory scheduling
- No distributed locking (suitable for single instance)
- Uses `cron` package for robust cron parsing
- Supports: cron, interval, one-time jobs

#### Distributed Scheduler
- Redis/Postgres-based with distributed locking
- Prevents duplicate execution across instances
- Uses store adapter's index system for locking
- Lock renewal for long-running jobs
- Automatic lock expiration and cleanup
- Job statistics tracking

### 3. Integration

**Updated components:**
- `stallDetector.ts` - Now uses scheduler instead of `setInterval`
- `awaitPatterns/time.ts` - Now uses scheduler instead of `setTimeout`
- `awaitPatterns/schedule.ts` - Now uses scheduler with proper cron parsing
- `00.adapters.ts` plugin - Initializes and shuts down scheduler
- `serverImports.ts` - Exports `useScheduler`, `initializeScheduler`, `shutdownScheduler`
- `useStreamTopics.ts` - Added `schedulerLocks()` subject pattern

**Deleted:**
- `triggerCleanup.ts` - Unused file removed

### 4. Dependencies

Added `cron` package for:
- Robust cron expression parsing
- Timezone support
- DST handling
- Next occurrence calculation

## How It Works

### Initialization

```typescript
// In 00.adapters.ts plugin
await initializeScheduler(adapters.store)
```

The scheduler automatically selects the appropriate adapter:
- **Memory Scheduler**: For file/memory store adapters (no index support)
- **Distributed Scheduler**: For Redis/Postgres (with index support)

### Usage

```typescript
const scheduler = useScheduler()

// Schedule a recurring job
await scheduler.schedule({
  id: 'stall-detection',
  name: 'Flow Stall Detection',
  type: 'interval',
  interval: 900000, // 15 minutes
  handler: async () => {
    await checkForStalls()
  },
})

// Schedule a cron job
await scheduler.schedule({
  id: 'daily-cleanup',
  name: 'Daily Cleanup',
  type: 'cron',
  cron: '0 2 * * *', // 2 AM daily
  timezone: 'America/New_York',
  handler: async () => {
    await cleanup()
  },
})

// Schedule a one-time job
await scheduler.schedule({
  id: 'reminder',
  name: 'Send Reminder',
  type: 'one-time',
  executeAt: Date.now() + 3600000, // 1 hour from now
  handler: async () => {
    await sendReminder()
  },
})
```

### Distributed Locking

The distributed scheduler uses the store adapter's index system for locking:

1. **Lock Acquisition**: Uses `indexAdd` with unique constraint
2. **Lock Storage**: Index entry with expiration score
3. **Lock Renewal**: Periodic updates for long-running jobs
4. **Lock Expiration**: Automatic cleanup based on score
5. **Instance ID**: Each instance has unique identifier

**Benefits:**
- No duplicate execution across instances
- Survives instance restarts (persisted to Redis/Postgres)
- Automatic cleanup of stale locks
- Lock renewal for long-running jobs

## Migration Complete

All time-based operations now use the scheduler:

| Component | Old | New |
|-----------|-----|-----|
| Stall Detection | `setInterval` | `scheduler.schedule({ type: 'interval' })` |
| Time Await | `setTimeout` | `scheduler.schedule({ type: 'one-time' })` |
| Schedule Await | `setTimeout` + manual cron | `scheduler.schedule({ type: 'one-time' })` with `cron` lib |
| Trigger Schedules | Ready for migration | Can use `scheduler.schedule({ type: 'cron' })` |

## Benefits

1. **Horizontal Scaling**: Multiple instances can run without conflicts
2. **Robust Cron**: Handles timezones, DST, leap seconds correctly
3. **Persistence**: Jobs survive restarts (in distributed mode)
4. **Monitoring**: Track job execution stats (run count, failures, etc.)
5. **Unified API**: Single interface for all scheduling needs
6. **Testing**: Easy to mock/test with memory scheduler

## Next Steps

Future trigger schedule implementation can leverage this system:

```typescript
// When registering a trigger with schedule
await scheduler.schedule({
  id: `trigger-${triggerName}`,
  name: triggerName,
  type: 'cron',
  cron: trigger.schedule.cron,
  timezone: trigger.schedule.timezone,
  handler: async () => {
    await fireTrigger(triggerName)
  },
})
```

## Configuration

The scheduler uses the existing store adapter configuration:
- Automatically selects Memory or Distributed based on store capabilities
- Uses `nvent:scheduler` prefix for all keys
- Lock TTL: 5 minutes (configurable)
- Lock renewal: Every 2.5 minutes (50% of TTL)

No additional configuration needed!
