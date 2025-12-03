# Scheduler Job Recovery System

## Overview

The scheduler now implements **automatic job recovery on startup**, solving critical issues with restarts and horizontal scaling.

## Problem Solved

### Before (Memory-Only)
- ❌ Jobs lost on instance restart
- ❌ New instances don't know about existing jobs
- ❌ Orphaned await patterns (flows stuck waiting)
- ❌ Horizontal scaling doesn't work properly

### After (Persistent + Recovery)
- ✅ Jobs restored from store on startup
- ✅ All instances see all jobs
- ✅ Await patterns resume after restart
- ✅ Horizontal scaling works correctly

## How It Works

### 1. Job Persistence
```typescript
// When scheduling a job, it's persisted to:
// 1. KV store: nvent:scheduler:jobs:{jobId}
// 2. Index: nvent:scheduler:jobs-index (if available)

await scheduler.schedule({
  id: 'stall-detection',
  type: 'interval',
  interval: 60000,
  // ...
})
```

### 2. Startup Recovery
```typescript
// In scheduler.start():
1. Call recoverJobs()
2. Scan store for persisted jobs
3. Re-create in-memory CronJob/setTimeout/setInterval
4. Start all jobs
```

### 3. Recovery Strategy

#### With Index Support (Redis/Postgres)
- Efficiently scan `nvent:scheduler:jobs-index`
- Recovers ALL jobs (including await patterns)
- Fast and scalable

#### Without Index Support (File/Memory)
- Tries to recover "well-known" jobs (e.g., `stall-detection`)
- **Limited**: Cannot efficiently find dynamic await jobs
- **Recommendation**: Use Redis/Postgres for production

## Job Types Recovered

### ✅ Always Recovered
- **Stall Detection**: `stall-detection` (well-known ID)
- **Trigger Schedules**: Persistent cron-based triggers
- **Interval Jobs**: Any job with type='interval'

### ⚠️ Conditionally Recovered
- **Await Time**: `await-time-{runId}-{step}-{pos}` (dynamic IDs)
  - ✅ With Redis/Postgres (index scan)
  - ❌ With File/Memory (no efficient scan)
  
- **Await Schedule**: `await-schedule-{runId}-{step}-{pos}` (dynamic IDs)
  - ✅ With Redis/Postgres (index scan)
  - ❌ With File/Memory (no efficient scan)

## Horizontal Scaling Behavior

### Multiple Instances with Shared Store
```
Instance 1: Schedules job → Persists to store
Instance 2: Starts up → Recovers job from store
Instance 3: Starts up → Recovers job from store

Result: All 3 instances have the job
Lock: Only ONE instance executes at a time (distributed locking)
```

### Lock Acquisition Flow
```
1. Instance 1 acquires lock → Executes job
2. Instance 2 tries lock → Sees lock held → Skips
3. Instance 3 tries lock → Sees lock held → Skips

Next schedule:
- Instance 2 acquires lock → Executes
- Others skip
```

## Monitoring

### Get Jobs for This Instance
```typescript
const scheduler = useScheduler()
const jobs = await scheduler.getScheduledJobs()
console.log(`Instance has ${jobs.length} active jobs`)
```

### Get ALL Persisted Jobs (Across Instances)
```typescript
const scheduler = useScheduler()
const allJobs = await scheduler.getAllPersistedJobs()
console.log(`Total jobs in store: ${allJobs.length}`)
```

## Production Recommendations

### ✅ Recommended Setup
- **Store**: Redis or Postgres adapter
- **Reason**: Index support enables full recovery
- **Benefits**: All jobs recovered, efficient scanning

### ⚠️ Limited Setup
- **Store**: File or Memory adapter
- **Reason**: No index support
- **Limitations**: Only well-known jobs recovered
- **Use Case**: Single-instance deployments only

### Example: Redis Setup
```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['nvent', '@nvent-addon/adapter-store-redis'],
  nvent: {
    store: {
      adapter: 'redis',
      redis: {
        host: 'localhost',
        port: 6379
      }
    }
  }
})
```

## Edge Cases Handled

### 1. Duplicate Jobs
- ✅ Jobs are checked before re-scheduling
- If job already exists in memory, skip

### 2. Disabled Jobs
- ✅ Jobs with `enabled: false` are skipped
- Won't be re-created on startup

### 3. Recovery Failure
- ✅ Errors are caught and logged
- Scheduler continues starting (fails gracefully)

### 4. One-Time Jobs
- ✅ Past `executeAt` jobs are auto-cleaned after execution
- Won't be recovered on restart (already executed)

## Logging

```
[Scheduler] Recovering jobs from store...
[Scheduler] Found 5 jobs in index
[Scheduler] Recovered job: stall-detection (interval)
[Scheduler] Recovered job: await-schedule-abc123-step1-0 (one-time)
[Scheduler] Skipping disabled job: old-cleanup
[Scheduler] Started with 4 active jobs
```

## Migration Guide

### Existing Installations
No action required! The recovery system is **automatic**.

### New Installations
1. Install with Redis/Postgres store (recommended)
2. Schedule jobs as before
3. Recovery happens automatically on restart

### Testing Recovery
```bash
# 1. Start app and schedule a job
curl http://localhost:3000/api/schedule-test

# 2. Restart app
# Jobs are automatically recovered

# 3. Verify recovery
curl http://localhost:3000/api/scheduler/status
```

## Future Improvements

1. **KV Scan Support**: Add `kvScan()` to store adapter interface for file/memory stores
2. **Orphan Cleanup**: Detect and clean up truly orphaned await jobs
3. **Health Monitoring**: Expose metrics for recovered vs failed jobs
4. **Graceful Degradation**: Warn users about limited recovery with file stores

## Conclusion

The scheduler is now **production-ready for horizontal scaling** with the following requirements:

- ✅ **Single Instance + Any Store**: Works perfectly
- ✅ **Multi Instance + Redis/Postgres**: Full recovery, production ready
- ⚠️ **Multi Instance + File/Memory**: Limited recovery, document limitations
