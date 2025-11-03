# Flow Scheduling Implementation - v0.4

## Summary

Successfully implemented the v0.4 flow scheduling feature as specified in `/specs/v0.4/flow-scheduling.md`. This provides a pragmatic scheduling solution for flows using BullMQ's repeatable jobs infrastructure with a **marker pattern** for proper flow index creation.

## What Was Implemented

### Backend API (3 endpoints)

1. **POST `/api/_flows/:name/schedule`** - Create new schedule
   - Supports cron patterns (e.g., `*/5 * * * *` for every 5 minutes)
   - Supports one-time delays (milliseconds)
   - Accepts input data and metadata
   - **Uses marker pattern**: Adds `__scheduledFlowStart`, `__flowName`, `__flowInput` to job data
   - Returns schedule ID and configuration

2. **GET `/api/_flows/:name/schedules`** - List schedules
   - Returns all schedules for a specific flow
   - Includes next run time and metadata
   - Filters by flow's entry step

3. **DELETE `/api/_flows/:name/schedules/:id`** - Remove schedule
   - Deletes repeatable job by key
   - Returns success confirmation

### Worker Modification

**File**: `src/runtime/server/worker/runner/node.ts`

Added marker detection logic before handler execution:
```typescript
if (job.data?.__scheduledFlowStart) {
  const { __flowName, __flowInput } = job.data
  const { useFlowEngine } = await import('../../../utils/useFlowEngine')
  await useFlowEngine().startFlow(__flowName, __flowInput)
  return { success: true, scheduledFlow: true }
}
```

**Why this matters**: Without this, scheduled flows would execute the entry step handler directly without creating a flow index, resulting in runs with no step tracking or proper event emission.

### Frontend UI (2 components)

1. **FlowScheduleDialog** (`src/runtime/app/components/FlowScheduleDialog.vue`)
   - Modal dialog for creating schedules
   - Tab interface for cron vs delay selection
   - Cron pattern presets (every minute, hourly, daily, weekly, monthly, custom)
   - Delay input with time unit selector (seconds, minutes, hours, days)
   - JSON input editor with validation
   - Description field for metadata

2. **FlowSchedulesList** (`src/runtime/app/components/FlowSchedulesList.vue`)
   - Displays all schedules for a flow
   - Shows cron pattern and next run time
   - Delete button for each schedule
   - Loading and error states
   - Auto-refresh on flow change
   - Exposes `loadSchedules()` method for programmatic refresh

### Integration

- Added "Schedule" button to flows page (next to "Start" button)
- Opens FlowScheduleDialog modal
- FlowSchedulesList component integrated in collapsible section below runs list
- Auto-refreshes schedules list when new schedule is created or deleted
- Collapsible UI with chevron icon toggle

## Architecture Flow

```
User clicks "Schedule" button
    ↓
FlowScheduleDialog modal opens
    ↓
User configures schedule (cron/delay + input)
    ↓
POST /api/_flows/:name/schedule
    ↓
Registry lookup → Get flow entry point
    ↓
Queue.add() with markers and repeat options
    ↓
Schedule stored in Redis (BullMQ repeatable job)
    ↓
BullMQ triggers job at scheduled time
    ↓
Worker detects __scheduledFlowStart marker
    ↓
Worker calls startFlow(__flowName, __flowInput)
    ↓
Flow engine creates flow index and events
    ↓
Flow continues execution normally with proper tracking
```

## Testing Results

All API endpoints tested successfully:

```
✅ Create schedule with cron pattern (*/5 * * * *)
✅ List schedules (found 1 schedule)
✅ Create schedule with delay (60000ms)
✅ Delete schedule
✅ Verify deletion (0 remaining schedules)
✅ Scheduled flows create proper flow index
✅ Scheduled flows tracked in runs with all steps
```

Test script: `test-scheduling.js`

## How to Use

### Via API

```bash
# Create a schedule
curl -X POST http://localhost:3000/api/_flows/example-flow/schedule \
  -H "Content-Type: application/json" \
  -d '{
    "cron": "0 2 * * *",
    "input": {"test": true},
    "metadata": {"description": "Daily at 2 AM"}
  }'

# List schedules
curl http://localhost:3000/api/_flows/example-flow/schedules

# Delete schedule
curl -X DELETE http://localhost:3000/api/_flows/example-flow/schedules/{scheduleId}
```

### Via UI

1. Navigate to the Flows page
2. Select a flow from the dropdown
3. Click the "Schedule" button
4. Choose between cron pattern or delay
5. Enter input data (optional)
6. Add description (optional)
7. Click "Schedule Flow"

## Files Created/Modified

### Created
- `src/runtime/server/api/_flows/[name]/schedule.post.ts`
- `src/runtime/server/api/_flows/[name]/schedules.get.ts`
- `src/runtime/server/api/_flows/[name]/schedules/[id].delete.ts`
- `src/runtime/app/components/FlowScheduleDialog.vue`
- `src/runtime/app/components/FlowSchedulesList.vue`
- `specs/v0.4/flow-scheduling.md` (specification)
- `specs/v0.4/IMPLEMENTATION-SCHEDULING.md` (this file)

### Modified
- `src/runtime/server/worker/runner/node.ts` - Added marker detection for scheduled flow starts
- `src/runtime/app/pages/flows/index.vue` - Added Schedule button, schedules list, and dialog integration
- `specs/v0.4/current-implementation.md` - Updated to document scheduling feature
- `specs/v0.5/trigger-system.md` - Added migration note

## Architecture

```
User clicks "Schedule" button
    ↓
FlowScheduleDialog modal opens
    ↓
User configures schedule (cron/delay + input)
    ↓
POST /api/_flows/:name/schedule
    ↓
Registry lookup → Get flow entry point
    ↓
useQueue().schedule() → BullMQ repeatable job
    ↓
Schedule stored in Redis
    ↓
BullMQ worker triggers at scheduled time
    ↓
Flow runs with provided input
```

## Cron Patterns Available

- **Every minute**: `* * * * *`
- **Every 5 minutes**: `*/5 * * * *`
- **Every hour**: `0 * * * *`
- **Daily at 2 AM**: `0 2 * * *`
- **Daily at noon**: `0 12 * * *`
- **Weekly (Monday 9 AM)**: `0 9 * * 1`
- **Monthly (1st at midnight)**: `0 0 1 * *`
- **Custom**: User-defined pattern

## Key Technical Implementation: Marker Pattern

The critical innovation in this implementation is the **marker pattern** for proper flow index creation:

### The Problem
When BullMQ triggers a scheduled job, it normally calls the entry step's handler directly. This bypasses the flow engine's `startFlow()` method, which means:
- No flow index is created
- No flow events are emitted
- Flow runs appear empty with no step tracking

### The Solution
1. **Schedule API adds markers**: When creating a schedule, the API adds special flags to job data:
   ```typescript
   {
     __scheduledFlowStart: true,
     __flowName: 'cleanup-flow',
     __flowInput: { retentionDays: 30 }
   }
   ```

2. **Worker detects markers**: Before executing the handler, the worker checks for `__scheduledFlowStart`:
   ```typescript
   if (job.data?.__scheduledFlowStart) {
     await useFlowEngine().startFlow(__flowName, __flowInput)
     return { success: true, scheduledFlow: true }
   }
   ```

3. **Flow engine creates index**: `startFlow()` creates the flow index and properly initializes all tracking, then continues with normal execution.

### Why This Works
- ✅ **Simple**: No additional queues or workers needed
- ✅ **Reliable**: Uses existing flow engine infrastructure
- ✅ **Transparent**: Scheduled flows behave identically to manually started flows
- ✅ **Maintainable**: Single point of change in worker, no complex routing

## Known Limitations

1. No edit functionality (must delete and recreate)
2. No pause/resume capability
3. Delay-based schedules don't appear in list endpoint (BullMQ limitation: repeatable jobs are cron-only)
4. No historical tracking of schedule executions (use flow runs list for that)

## Future Enhancements (v0.5)

This temporary solution will be replaced by the comprehensive trigger system in v0.5, which will include:
- Event-based triggers
- Webhook triggers
- Advanced scheduling with conditions
- Await patterns for pausing flows
- Full trigger management UI
- Schedule editing
- Historical tracking

## Migration Path

When v0.5 trigger system is implemented, existing schedules can be migrated using a conversion tool that transforms BullMQ repeatable jobs into v0.5 schedule triggers.

---

**Status**: ✅ Complete and tested
**Version**: v0.4
**Date**: 2025-11-03
