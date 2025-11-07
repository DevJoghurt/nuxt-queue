# Flow Scheduling - v0.4

> **Version**: v0.4.x  
> **Status**: ✅ Implemented  
> **Last Updated**: 2025-11-04  
> **Deprecation Notice**: ⚠️ This simple scheduling approach will be replaced by the comprehensive trigger system in v0.5

## Overview

Flow scheduling enables automatic execution of flows based on time patterns (cron) or delays. This is useful for:

- **Periodic tasks**: Daily cleanup, hourly syncs, weekly reports
- **Delayed execution**: Reminder notifications, grace periods, follow-ups
- **Scheduled workflows**: Backups, data imports, batch processing

The implementation leverages BullMQ's battle-tested repeatable jobs infrastructure, ensuring reliable distributed scheduling without additional services.

## Key Concepts

### Cron-based Scheduling

Execute flows on a recurring schedule using cron patterns:

```typescript
// Daily at 2 AM
{ cron: '0 2 * * *' }

// Every 5 minutes
{ cron: '*/5 * * * *' }

// Weekdays at 9 AM
{ cron: '0 9 * * 1-5' }
```

**Use cases**: Regular maintenance, periodic syncs, batch jobs

### Delay-based Scheduling

Execute flows once after a specified delay:

```typescript
// 5 minutes from now
{ delay: 300000 }  // milliseconds

// 1 hour from now
{ delay: 3600000 }
```

**Use cases**: Follow-up emails, reminder notifications, grace periods

### Flow Index Creation

Scheduled flows use a **marker pattern** to ensure proper flow tracking:

1. Schedule API adds special markers to job data (`__scheduledFlowStart`, `__flowName`, `__flowInput`)
2. Worker detects markers before execution
3. Worker calls `startFlow()` to create flow index and events
4. Flow executes normally with full step tracking

This ensures scheduled flows behave identically to manually started flows.

## How to Use

### Via API

#### Create a Schedule

```bash
# Recurring schedule with cron pattern
curl -X POST http://localhost:3000/api/_flows/cleanup-flow/schedule \
  -H "Content-Type: application/json" \
  -d '{
    "cron": "0 2 * * *",
    "input": { "retentionDays": 30 },
    "metadata": {
      "description": "Daily cleanup job",
      "createdBy": "admin"
    }
  }'

# One-time delayed execution
curl -X POST http://localhost:3000/api/_flows/reminder-flow/schedule \
  -H "Content-Type: application/json" \
  -d '{
    "delay": 300000,
    "input": { "userId": "123", "message": "Check your email" }
  }'
```

#### List Schedules

```bash
curl http://localhost:3000/api/_flows/cleanup-flow/schedules
```

#### Delete a Schedule

```bash
curl -X DELETE http://localhost:3000/api/_flows/cleanup-flow/schedules/schedule-id
```

### Via Development UI

1. **Navigate to Flows page** at `http://localhost:3000/__queue`
2. **Select a flow** from the dropdown
3. **Click "Schedule"** button next to "Start"
4. **Configure schedule**:
   - Choose between cron pattern or delay
   - Select from presets or enter custom pattern
   - Provide input data (JSON)
   - Add description (optional)
5. **View schedules** in collapsible section below flow runs
6. **Delete schedules** using trash icon

### Via TypeScript

```typescript
// In your application code
const response = await $fetch('/api/_flows/my-flow/schedule', {
  method: 'POST',
  body: {
    cron: '0 */2 * * *',  // Every 2 hours
    input: { source: 'api' },
    metadata: {
      description: 'Hourly sync from API'
    }
  }
})

console.log(`Schedule created: ${response.id}`)
```

## API Reference

### POST `/api/_flows/:flowName/schedule`

Create a new schedule for a flow.

```typescript
POST /api/_flows/:flowName/schedule

Body: {
  input?: any,              // Flow input data (optional)
  cron?: string,            // Cron pattern (mutually exclusive with delay)
  delay?: number,           // One-time delay in milliseconds
  jobId?: string,           // Custom job ID (optional, for idempotency)
  metadata?: {
    description?: string,   // Human-readable description
    createdBy?: string,     // User/system that created schedule
    tags?: string[]         // Optional tags for organization
  }
}

Response: {
  id: string,               // Schedule ID (BullMQ repeatable job key)
  flowName: string,
  queue: string,            // Entry queue name
  step: string,             // Entry step name
  schedule: {
    cron?: string,
    delay?: number
  },
  nextRun?: string,         // ISO timestamp of next execution
  createdAt: string         // ISO timestamp
}

Examples:
// Daily at 2 AM
POST /api/_flows/cleanup-flow/schedule
{
  "cron": "0 2 * * *",
  "input": { "retentionDays": 30 },
  "metadata": {
    "description": "Daily cleanup job",
    "createdBy": "admin"
  }
}

// Every hour
POST /api/_flows/sync-flow/schedule
{
  "cron": "0 * * * *",
  "input": { "source": "api" }
}

// One-time delayed execution (5 minutes)
POST /api/_flows/reminder-flow/schedule
{
  "delay": 300000,
  "input": { "userId": "123", "message": "Check your email" }
}
```

**Response:**
```typescript
{
  id: string,               // Schedule ID (use for deletion)
  flowName: string,
  queue: string,
  step: string,
  schedule: {
    cron?: string,
    delay?: number
  },
  createdAt: string         // ISO timestamp
}
```

### GET `/api/_flows/:flowName/schedules`

List all schedules for a flow.

**Response:**
```typescript
[
  {
    id: string,
    flowName: string,
    queue: string,
    step: string,
    schedule: {
      cron?: string,
      delay?: number
    },
    nextRun?: string,       // ISO timestamp of next execution
    createdAt: string
  }
]
```

### DELETE `/api/_flows/:flowName/schedules/:scheduleId`

Delete a schedule.

**Response:**
```typescript
{
  success: boolean,
  message: string
}
```

## Cron Pattern Reference

Common patterns for scheduling:

| Pattern | Description | Use Case |
|---------|-------------|----------|
| `* * * * *` | Every minute | Testing, rapid polling |
| `*/5 * * * *` | Every 5 minutes | Frequent syncs |
| `0 * * * *` | Every hour | Regular updates |
| `0 */2 * * *` | Every 2 hours | Periodic checks |
| `0 9 * * *` | Daily at 9 AM | Morning jobs |
| `0 2 * * *` | Daily at 2 AM | Overnight maintenance |
| `0 12 * * *` | Daily at noon | Midday reports |
| `0 0 * * *` | Daily at midnight | End of day processing |
| `0 9 * * 1` | Every Monday at 9 AM | Weekly reports |
| `0 9 * * 1-5` | Weekdays at 9 AM | Business day jobs |
| `0 0 1 * *` | 1st of month | Monthly processing |
| `0 0 1 1 *` | January 1st | Annual jobs |

**Format**: `minute hour day month weekday`

**Resources**:
- [Crontab Guru](https://crontab.guru/) - Interactive cron expression builder
- [BullMQ Repeatable Jobs](https://docs.bullmq.io/guide/jobs/repeatable) - Official documentation

## How It Works

### Architecture Overview

```
User/API Request
    ↓
Schedule API validates flow exists
    ↓
Create BullMQ job with markers:
  • __scheduledFlowStart: true
  • __flowName: 'cleanup-flow'
  • __flowInput: { retentionDays: 30 }
    ↓
BullMQ stores as repeatable job
    ↓
⏰ Time passes...
    ↓
BullMQ triggers job at scheduled time
    ↓
Worker receives job, checks for __scheduledFlowStart
    ↓
Worker calls useFlowEngine().startFlow()
    ↓
Flow index created (nq:flows:<flowName>)
Flow run starts with proper events
    ↓
Flow executes normally with full tracking
```

### Storage

Schedules are stored as BullMQ repeatable jobs in Redis:

- **Key**: `bull:{queueName}:repeat` (sorted set)
- **Format**: `{jobName}:{cronPattern}:{timestamp}`
- **Size**: ~100-200 bytes per schedule
- **Distributed**: Works across multiple instances
- **Automatic**: BullMQ handles next execution calculation

### Execution Flow

1. **Job Trigger**: BullMQ detects scheduled time and creates job
2. **Marker Detection**: Worker checks `job.data.__scheduledFlowStart`
3. **Flow Start**: Worker calls `startFlow(__flowName, __flowInput)`
4. **Index Creation**: Flow engine creates entry in `nq:flows:<flowName>`
5. **Event Emission**: Flow starts emitting events to stream
6. **Normal Execution**: Flow continues through steps normally
7. **UI Updates**: Real-time updates via SSE/WebSocket

## Best Practices

### Scheduling Strategy

✅ **Use descriptive metadata**: Add descriptions to identify schedules later
```typescript
metadata: {
  description: 'Daily cleanup - removes items older than 30 days',
  createdBy: 'admin',
  tags: ['maintenance', 'cleanup']
}
```

✅ **Monitor execution**: Check flow runs list to ensure schedules execute correctly

✅ **Test patterns first**: Start with frequent patterns (every minute) to test, then adjust

✅ **Consider time zones**: BullMQ uses server timezone - configure if needed

✅ **Clean up unused schedules**: Delete old schedules to reduce Redis memory

✅ **Use delays for one-time events**: Don't use cron for single executions

### Common Patterns

**Daily Maintenance** (runs at low-traffic hours):
```typescript
{ cron: '0 2 * * *', input: { ... } }  // 2 AM daily
```

**Business Hours Sync** (weekdays only):
```typescript
{ cron: '0 9 * * 1-5', input: { ... } }  // 9 AM Mon-Fri
```

**Hourly Checks**:
```typescript
{ cron: '0 * * * *', input: { ... } }  // Top of every hour
```

**Grace Period Reminder** (one-time):
```typescript
{ delay: 86400000, input: { userId, action } }  // 24 hours
```

### Troubleshooting

**Schedule not executing?**
- Check flow exists and has entry point
- Verify cron pattern with [crontab.guru](https://crontab.guru/)
- Check BullMQ worker is running
- Look for errors in worker logs

**Flow runs missing steps?**
- This is prevented by marker pattern
- Check worker has marker detection code
- Verify `startFlow()` is called for scheduled jobs

**Too many schedules?**
- List all schedules: `GET /api/_flows/{flowName}/schedules`
- Delete unused ones to free memory
- Consider consolidating similar schedules

**Time zone issues?**
- BullMQ uses server time
- Configure timezone in BullMQ options if needed
- Document expected timezone in metadata

## Limitations & Future

### Current Limitations

1. **No webhooks or event triggers**: Only time-based scheduling (v0.5 will add triggers)
2. **No pause/resume**: Must delete and recreate to modify schedule
3. **No edit functionality**: Edit requires delete + recreate
4. **Single entry point only**: Can only schedule flow entry, not arbitrary steps
5. **Basic UI**: No visual cron builder (presets only)
6. **No execution history**: Track via flow runs list instead

### Migration to v0.5

This scheduling implementation is a bridge to v0.5's comprehensive trigger system:

**v0.4 (Current)**:
```typescript
POST /api/_flows/cleanup-flow/schedule
{ cron: '0 2 * * *', input: { days: 30 } }
```

**v0.5 (Future)**:
```typescript
{
  name: 'cleanup-flow.daily',
  type: 'schedule',
  schedule: { cron: '0 2 * * *' },
  target: { flow: 'cleanup-flow', input: { days: 30 } },
  actions: ['log', 'notify'],
  conditions: { minDiskSpace: '10GB' }
}
```

**Migration path**:
1. v0.5 will include automatic migration tool
2. Existing schedules will be converted to schedule triggers
3. v0.4 API will be deprecated but remain functional
4. Full removal planned for v0.6

**v0.5 additions**:
- 🎯 Trigger types: schedule, webhook, event, manual
- ⏱️ Await patterns: time, event, condition
- 🔗 Webhook auto-setup with URL generation
- 📊 Execution history and analytics
- ⏸️ Pause/resume functionality
- ✏️ Edit without recreation

## Related Documentation

- **[Implementation Notes](./IMPLEMENTATION-SCHEDULING.md)** - Implementation details and marker pattern
- **[v0.5 Trigger System](../v0.5/trigger-system.md)** - Future comprehensive trigger architecture
- **[Current Implementation](./current-implementation.md)** - Complete v0.4 architecture
- **[Quick Reference](./quick-reference.md)** - API patterns and examples

---

**Version**: v0.4.x  
**Status**: ✅ Implemented  
**Deprecation**: ⚠️ Will be replaced by v0.5 trigger system
