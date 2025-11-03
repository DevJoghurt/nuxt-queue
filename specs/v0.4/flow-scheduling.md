# Flow Scheduling - v0.4 Simple Implementation

> **Version**: v0.4.x  
> **Status**: ✅ Implementation Spec  
> **Last Updated**: 2025-11-03  
> **Deprecation Notice**: ⚠️ This simple scheduling approach will be replaced by the comprehensive trigger system in v0.5

## Overview

A pragmatic scheduling solution for v0.4 that enables reliable cron-based and delayed flow execution without implementing the full trigger system planned for v0.5.

This implementation leverages existing BullMQ repeatable jobs infrastructure to provide basic scheduling capabilities with minimal new code.

## Design Goals

✅ **Simple**: Use existing `schedule()` function, no new infrastructure  
✅ **Reliable**: Leverage battle-tested BullMQ repeatable jobs  
✅ **Practical**: Cover 80% of scheduling use cases  
✅ **UI-Friendly**: Easy to configure via development UI  
✅ **Temporary**: Bridging solution until v0.5 trigger system  

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Flow Schedule UI                      │
│  • Cron pattern selector (presets + custom)            │
│  • One-time delay option                               │
│  • Schedule management (view/delete)                   │
│  • Integrated into flows page sidebar                  │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│              Schedule API Endpoints                     │
│  POST   /api/_flows/:name/schedule                     │
│  GET    /api/_flows/:name/schedules                    │
│  DELETE /api/_flows/:name/schedules/:id                │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│         BullMQ Queue.add() with Markers                 │
│  • Adds job with __scheduledFlowStart marker           │
│  • Stores __flowName and __flowInput                   │
│  • Uses BullMQ repeat option for scheduling            │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│                BullMQ Repeatable Jobs                   │
│  • Native cron pattern support                         │
│  • Built-in job management                             │
│  • Distributed scheduling                              │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│           Worker with Marker Detection                  │
│  • Detects __scheduledFlowStart marker                 │
│  • Calls startFlow(__flowName, __flowInput)            │
│  • Creates proper flow index and events                │
└─────────────────────────────────────────────────────────┘
```

### Flow Index Creation Pattern

Scheduled flows require special handling to create the flow index properly:

1. **Marker Pattern**: Schedule API adds `__scheduledFlowStart` marker to job data
2. **Worker Detection**: Node.js worker checks for marker before executing handler
3. **Flow Engine**: If marker present, calls `startFlow()` instead of normal handler
4. **Proper Index**: `startFlow()` creates flow index, events, and continues execution

This ensures scheduled flows have the same structure as manually started flows.

## API Specification

### 1. Schedule Flow Execution

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

### 2. List Scheduled Flows

Get all schedules for a flow.

```typescript
GET /api/_flows/:flowName/schedules

Response: [
  {
    id: string,             // Schedule ID
    flowName: string,
    queue: string,
    step: string,
    schedule: {
      cron?: string,
      delay?: number
    },
    nextRun?: string,       // ISO timestamp
    input?: any,            // Stored input data
    metadata?: {
      description?: string,
      createdBy?: string,
      tags?: string[]
    },
    stats?: {
      count: number,        // Number of times executed
      lastRun?: string      // ISO timestamp of last execution
    },
    createdAt: string
  }
]
```

### 3. Remove Schedule

Delete a scheduled flow.

```typescript
DELETE /api/_flows/:flowName/schedules/:scheduleId

Response: {
  success: boolean,
  message: string
}
```

### 4. List All Schedules (Optional)

Get schedules across all flows.

```typescript
GET /api/_flows/schedules

Query Parameters:
  - flowName?: string     // Filter by flow name
  - tag?: string          // Filter by tag

Response: [
  {
    id: string,
    flowName: string,
    queue: string,
    step: string,
    schedule: { cron?: string, delay?: number },
    nextRun?: string,
    metadata?: {...},
    createdAt: string
  }
]
```

## Implementation

### Backend

#### 1. Schedule Endpoint

```typescript
// src/runtime/server/api/_flows/[name]/schedule.post.ts
import { defineEventHandler, readBody, getRouterParam, createError } from '#imports'
import { useQueue } from '../../../utils/useQueue'
import { $useQueueRegistry } from '#imports'
import { Queue } from 'bullmq'
import { useRuntimeConfig } from '#imports'

export default defineEventHandler(async (event) => {
  const flowName = getRouterParam(event, 'name')
  if (!flowName) {
    throw createError({ statusCode: 400, message: 'Flow name required' })
  }

  const body = await readBody(event)
  const { input, cron, delay, metadata } = body

  // Validate: either cron OR delay, not both
  if (cron && delay) {
    throw createError({ 
      statusCode: 400, 
      message: 'Cannot specify both cron and delay' 
    })
  }

  if (!cron && !delay) {
    throw createError({ 
      statusCode: 400, 
      message: 'Must specify either cron or delay' 
    })
  }

  // Get flow info
  const registry = $useQueueRegistry()
  const flow = (registry?.flows as Record<string, any>)?.[flowName]
  if (!flow || !flow.entry) {
    throw createError({ statusCode: 404, message: 'Flow not found' })
  }

  const rc = useRuntimeConfig() as any
  const connection = rc.queue?.redis
  const queue = new Queue(flow.entry.queue, { connection })

  try {
    // Create job data with markers for flow index creation
    const jobData = {
      __scheduledFlowStart: true,    // Marker for worker detection
      __flowName: flowName,           // Flow to start
      __flowInput: input || {},       // Input data for flow
      __metadata: metadata,           // Schedule metadata
    }

    // Build repeat options
    const repeatOpts: any = {}
    if (cron) {
      repeatOpts.pattern = cron
    }

    // Add job with repeat
    const job = await queue.add(
      flow.entry.step,
      jobData,
      {
        repeat: repeatOpts,
        delay: delay || undefined,
      }
    )

    const scheduleId = job.repeatJobKey || job.id

    await queue.close()

    return {
      id: scheduleId,
      flowName,
      queue: flow.entry.queue,
      step: flow.entry.step,
      schedule: { cron, delay },
      createdAt: new Date().toISOString(),
    }
  } catch (error: any) {
    await queue.close()
    throw createError({
      statusCode: 500,
      message: `Failed to create schedule: ${error.message}`,
    })
  }
})
```

#### 2. List Schedules Endpoint

```typescript
// src/runtime/server/api/_flows/[name]/schedules.get.ts
import { defineEventHandler, getRouterParam, createError } from '#imports'
import { $useQueueRegistry } from '#imports'
import { Queue } from 'bullmq'
import { useRuntimeConfig } from '#imports'

export default defineEventHandler(async (event) => {
  const flowName = getRouterParam(event, 'name')
  if (!flowName) {
    throw createError({ statusCode: 400, message: 'Flow name required' })
  }

  const registry = $useQueueRegistry()
  const flow = (registry?.flows as Record<string, any>)?.[flowName]
  if (!flow || !flow.entry) {
    throw createError({ statusCode: 404, message: 'Flow not found' })
  }

  const rc = useRuntimeConfig() as any
  const connection = rc.queue?.redis

  // Get repeatable jobs from BullMQ
  const queue = new Queue(flow.entry.queue, { connection })
  const repeatableJobs = await queue.getRepeatableJobs()

  // Filter for this flow's entry step
  const schedules = repeatableJobs
    .filter((job) => job.name === flow.entry.step)
    .map((job) => ({
      id: job.key,
      flowName,
      queue: flow.entry.queue,
      step: flow.entry.step,
      schedule: {
        cron: job.pattern,
      },
      nextRun: job.next ? new Date(job.next).toISOString() : undefined,
    }))

  await queue.close()

  return schedules
})
```

#### 3. Delete Schedule Endpoint

```typescript
// src/runtime/server/api/_flows/[name]/schedules/[id].delete.ts
import { defineEventHandler, getRouterParam, createError } from '#imports'
import { $useQueueRegistry } from '#imports'
import { Queue } from 'bullmq'
import { useRuntimeConfig } from '#imports'

export default defineEventHandler(async (event) => {
  const flowName = getRouterParam(event, 'name')
  const scheduleId = getRouterParam(event, 'id')
  
  if (!flowName || !scheduleId) {
    throw createError({ statusCode: 400, message: 'Flow name and schedule ID required' })
  }

  const registry = $useQueueRegistry()
  const flow = (registry?.flows as Record<string, any>)?.[flowName]
  if (!flow || !flow.entry) {
    throw createError({ statusCode: 404, message: 'Flow not found' })
  }

  const rc = useRuntimeConfig() as any
  const connection = rc.queue?.redis

  const queue = new Queue(flow.entry.queue, { connection })
  
  try {
    // Remove repeatable job by key
    await queue.removeRepeatableByKey(scheduleId)
    await queue.close()
    
    return {
      success: true,
      message: 'Schedule deleted successfully',
    }
  } catch (error: any) {
    await queue.close()
    throw createError({ 
      statusCode: 500, 
      message: `Failed to delete schedule: ${error.message}` 
    })
  }
})
```

#### 4. Worker Modification for Flow Index Creation

```typescript
// src/runtime/server/worker/runner/node.ts
// ... existing imports ...

export async function createNodeWorker(queueName: string) {
  const worker = new Worker(queueName, async (job) => {
    // Check if this is a scheduled flow start
    if (job.data?.__scheduledFlowStart) {
      const { __flowName, __flowInput } = job.data
      
      // Import flow engine dynamically to avoid circular dependencies
      const { useFlowEngine } = await import('../../../utils/useFlowEngine')
      const flowEngine = useFlowEngine()
      
      // Start the flow properly (creates flow index and events)
      await flowEngine.startFlow(__flowName, __flowInput)
      
      return { success: true, scheduledFlow: true }
    }

    // Normal job execution
    const handler = handlers[queueName]?.[job.name]
    if (!handler) {
      throw new Error(`No handler found for ${queueName}:${job.name}`)
    }

    return await handler(job.data)
  }, {
    connection: useRuntimeConfig().queue?.redis,
  })

  return worker
}
```

**Key Implementation Detail**: The marker pattern ensures that scheduled flows:
1. Are added as regular BullMQ jobs with repeat options
2. Carry marker flags in job data (`__scheduledFlowStart`, `__flowName`, `__flowInput`)
3. Get detected by worker before handler execution
4. Call `startFlow()` to create proper flow index and event structure
5. Execute normally through the flow engine

### Frontend UI

#### 1. Schedule Dialog Component

```vue
<!-- src/runtime/app/components/FlowScheduleDialog.vue -->
<template>
  <UModal v-model="isOpen" title="Schedule Flow">
    <div class="space-y-4 p-4">
      <div>
        <label class="block text-sm font-medium mb-2">Schedule Type</label>
        <URadioGroup v-model="scheduleType" :options="typeOptions" />
      </div>

      <div v-if="scheduleType === 'cron'">
        <label class="block text-sm font-medium mb-2">Pattern</label>
        <USelectMenu
          v-model="selectedPreset"
          :items="cronPresets"
          placeholder="Select preset or custom"
        />
        <UInput
          v-if="selectedPreset?.value === 'custom'"
          v-model="customCron"
          placeholder="0 2 * * *"
          class="mt-2"
        />
        <p class="text-xs text-gray-500 mt-1">
          Next run: {{ nextRunPreview }}
        </p>
      </div>

      <div v-else-if="scheduleType === 'delay'">
        <label class="block text-sm font-medium mb-2">Delay</label>
        <div class="flex gap-2">
          <UInput v-model="delayValue" type="number" placeholder="5" />
          <USelectMenu v-model="delayUnit" :items="delayUnits" />
        </div>
      </div>

      <div>
        <label class="block text-sm font-medium mb-2">
          Input Data (JSON)
        </label>
        <UTextarea
          v-model="inputJson"
          placeholder='{ "key": "value" }'
          :rows="4"
        />
      </div>

      <div>
        <label class="block text-sm font-medium mb-2">Description</label>
        <UInput
          v-model="description"
          placeholder="Daily cleanup job"
        />
      </div>

      <div class="flex justify-end gap-2 pt-4">
        <UButton color="neutral" variant="ghost" @click="isOpen = false">
          Cancel
        </UButton>
        <UButton
          color="primary"
          :loading="isSubmitting"
          @click="handleSubmit"
        >
          Schedule Flow
        </UButton>
      </div>
    </div>
  </UModal>
</template>

<script setup lang="ts">
import { ref, computed } from '#imports'

const props = defineProps<{
  flowName: string
}>()

const emit = defineEmits<{
  scheduled: []
}>()

const isOpen = defineModel<boolean>()

const scheduleType = ref<'cron' | 'delay'>('cron')
const typeOptions = [
  { label: 'Recurring (Cron)', value: 'cron' },
  { label: 'One-time (Delay)', value: 'delay' },
]

const cronPresets = [
  { label: 'Every minute', value: '* * * * *' },
  { label: 'Every 5 minutes', value: '*/5 * * * *' },
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Daily at 2 AM', value: '0 2 * * *' },
  { label: 'Daily at noon', value: '0 12 * * *' },
  { label: 'Weekly (Monday 9 AM)', value: '0 9 * * 1' },
  { label: 'Monthly (1st at midnight)', value: '0 0 1 * *' },
  { label: 'Custom', value: 'custom' },
]

const selectedPreset = ref(cronPresets[3])
const customCron = ref('')

const delayValue = ref(5)
const delayUnit = ref({ label: 'Minutes', value: 60000 })
const delayUnits = [
  { label: 'Seconds', value: 1000 },
  { label: 'Minutes', value: 60000 },
  { label: 'Hours', value: 3600000 },
  { label: 'Days', value: 86400000 },
]

const inputJson = ref('')
const description = ref('')
const isSubmitting = ref(false)

const nextRunPreview = computed(() => {
  // TODO: Calculate next run time from cron pattern
  return 'Next calculation...'
})

const handleSubmit = async () => {
  isSubmitting.value = true
  try {
    let input: any = {}
    if (inputJson.value) {
      input = JSON.parse(inputJson.value)
    }

    const body: any = {
      input,
      metadata: {
        description: description.value,
      },
    }

    if (scheduleType.value === 'cron') {
      body.cron = selectedPreset.value?.value === 'custom' 
        ? customCron.value 
        : selectedPreset.value?.value
    } else {
      body.delay = delayValue.value * delayUnit.value.value
    }

    await $fetch(`/api/_flows/${props.flowName}/schedule`, {
      method: 'POST',
      body,
    })

    emit('scheduled')
    isOpen.value = false
  } catch (error: any) {
    console.error('Failed to schedule flow:', error)
    // TODO: Show error toast
  } finally {
    isSubmitting.value = false
  }
}
</script>
```

#### 2. Schedules List Component

```vue
<!-- src/runtime/app/components/FlowSchedulesList.vue -->
<template>
  <div class="space-y-2">
    <UAlert
      v-if="loading"
      icon="i-lucide-loader"
      title="Loading schedules..."
      color="primary"
    />

    <UAlert
      v-else-if="error"
      icon="i-lucide-alert-circle"
      :title="error"
      color="error"
    />

    <div v-else-if="schedules.length === 0" class="text-center py-4 text-gray-500 text-sm">
      No schedules configured
    </div>

    <div
      v-for="schedule in schedules"
      :key="schedule.id"
      class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg"
    >
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium truncate">
          {{ schedule.schedule.cron || `Delay: ${schedule.schedule.delay}ms` }}
        </div>
        <div v-if="schedule.nextRun" class="text-xs text-gray-500">
          Next: {{ formatDate(schedule.nextRun) }}
        </div>
      </div>
      <UButton
        icon="i-lucide-trash"
        color="error"
        variant="ghost"
        size="xs"
        :loading="deletingId === schedule.id"
        @click="handleDelete(schedule.id)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from '#imports'
import { UAlert, UButton, UIcon } from '#components'

const props = defineProps<{
  flowName: string
}>()

const emit = defineEmits<{
  updated: []
}>()

const schedules = ref<any[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const deletingId = ref<string | null>(null)

const loadSchedules = async () => {
  if (!props.flowName) return
  
  loading.value = true
  error.value = null
  
  try {
    const data = await $fetch(`/api/_flows/${props.flowName}/schedules`)
    schedules.value = Array.isArray(data) ? data : []
  } catch (err: any) {
    error.value = err.message || 'Failed to load schedules'
    schedules.value = []
  } finally {
    loading.value = false
  }
}

const handleDelete = async (id: string) => {
  deletingId.value = id
  try {
    await $fetch(`/api/_flows/${props.flowName}/schedules/${id}`, {
      method: 'DELETE',
    })
    await loadSchedules()
    emit('updated')
  } catch (error: any) {
    console.error('Failed to delete schedule:', error)
  } finally {
    deletingId.value = null
  }
}

const formatDate = (date?: string) => {
  if (!date) return 'N/A'
  return new Date(date).toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin',
  })
}

// Expose loadSchedules for parent component
defineExpose({ loadSchedules })

onMounted(() => {
  loadSchedules()
})

watch(() => props.flowName, () => {
  loadSchedules()
})
</script>
```

#### 3. Flows Page Integration

```vue
<!-- src/runtime/app/pages/flows/index.vue -->
<template>
  <!-- ... existing code ... -->
  
  <!-- Schedule button next to Start button -->
  <UButton
    icon="i-lucide-calendar-plus"
    color="primary"
    variant="soft"
    @click="openScheduleModal"
  >
    Schedule
  </UButton>

  <!-- ... existing runs section ... -->

  <!-- Schedules section below runs list -->
  <div v-if="selectedFlow" class="mt-6">
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-lg font-semibold flex items-center gap-2">
        <UIcon name="i-lucide-calendar" class="w-5 h-5" />
        Schedules
        <UIcon
          name="i-lucide-chevron-down"
          class="w-4 h-4 transition-transform cursor-pointer"
          :class="{ 'rotate-180': showSchedules }"
          @click="showSchedules = !showSchedules"
        />
      </h3>
    </div>

    <div
      v-if="showSchedules"
      class="max-h-48 overflow-y-auto"
    >
      <FlowSchedulesList
        ref="schedulesListRef"
        :flow-name="selectedFlow"
        @updated="handleSchedulesUpdated"
      />
    </div>
  </div>

  <!-- Schedule modal -->
  <FlowScheduleDialog
    v-model="scheduleModalOpen"
    :flow-name="selectedFlow || ''"
    @scheduled="handleFlowScheduled"
  />
</template>

<script setup lang="ts">
// ... existing imports ...
import FlowScheduleDialog from '../../components/FlowScheduleDialog.vue'
import FlowSchedulesList from '../../components/FlowSchedulesList.vue'

// ... existing code ...

// Schedules state
const showSchedules = ref(true)
const schedulesListRef = ref()
const scheduleModalOpen = ref(false)

const openScheduleModal = () => {
  scheduleModalOpen.value = true
}

const handleFlowScheduled = () => {
  // Refresh the schedules list after a schedule is created
  schedulesListRef.value?.loadSchedules()
}

const handleSchedulesUpdated = () => {
  // Called when schedules list needs to be refreshed
  schedulesListRef.value?.loadSchedules()
}
</script>
```

## Cron Pattern Reference

Common patterns for the UI preset selector:

```
* * * * *     Every minute
*/5 * * * *   Every 5 minutes
0 * * * *     Every hour
0 */2 * * *   Every 2 hours
0 9 * * *     Daily at 9 AM
0 12 * * *    Daily at noon
0 2 * * *     Daily at 2 AM
0 0 * * *     Daily at midnight
0 9 * * 1     Every Monday at 9 AM
0 9 * * 1-5   Weekdays at 9 AM
0 0 1 * *     First day of month at midnight
0 0 1 1 *     January 1st at midnight
```

## Storage & State

### BullMQ Repeatable Jobs

Schedules are stored as BullMQ repeatable jobs:
- Redis key: `bull:{queue}:repeat` (ZSET)
- Job key format: `{name}:{cron}:{timestamp}`
- Automatic distributed scheduling
- Built-in next run calculation

### Metadata Storage

Job data structure with markers:

```typescript
{
  // Marker flags for worker detection
  __scheduledFlowStart: true,
  __flowName: 'cleanup-flow',
  __flowInput: {
    // User provided input data
    retentionDays: 30
  },
  __metadata: {
    description: 'Daily cleanup',
    createdBy: 'admin',
    tags: ['maintenance']
  }
}
```

**Worker Detection Logic**:
```typescript
if (job.data?.__scheduledFlowStart) {
  const { __flowName, __flowInput } = job.data
  const { useFlowEngine } = await import('../../../utils/useFlowEngine')
  await useFlowEngine().startFlow(__flowName, __flowInput)
  return { success: true, scheduledFlow: true }
}
```

## Limitations

1. **No complex triggers**: Only cron and delay, no webhooks/events
2. **Basic UI**: Simple form, no visual cron builder
3. **Limited management**: No pause/resume, edit requires delete+recreate
4. **No history**: Doesn't track execution history (use flow runs for that)
5. **No validation**: Cron patterns not validated beyond BullMQ checks
6. **Single entry point**: Can only schedule flow entry, not arbitrary steps

## Migration to v0.5

When the v0.5 trigger system is implemented:

1. **Deprecate schedule endpoints**: Mark as deprecated, keep for compatibility
2. **Migration tool**: Convert existing schedules to v0.5 schedule triggers
3. **UI update**: Replace schedule dialog with trigger configuration
4. **Removal timeline**: Remove in v0.6 after one minor version overlap

### Migration Example

```typescript
// v0.4 schedule
POST /api/_flows/cleanup-flow/schedule
{ "cron": "0 2 * * *", "input": { "days": 30 } }

// Will become v0.5 trigger
{
  name: 'cleanup-flow.scheduled',
  type: 'schedule',
  scope: 'flow',
  schedule: { cron: '0 2 * * *' },
  data: { days: 30 }
}
```

## Testing

### Manual Testing

```bash
# Schedule a flow
curl -X POST http://localhost:3000/api/_flows/test-flow/schedule \
  -H "Content-Type: application/json" \
  -d '{"cron": "*/5 * * * *", "input": {"test": true}}'

# List schedules
curl http://localhost:3000/api/_flows/test-flow/schedules

# Delete schedule
curl -X DELETE http://localhost:3000/api/_flows/test-flow/schedules/{scheduleId}
```

### Automated Tests

```typescript
// test/flow-scheduling.test.ts
describe('Flow Scheduling', () => {
  it('should schedule a flow with cron pattern', async () => {
    const response = await $fetch('/api/_flows/test-flow/schedule', {
      method: 'POST',
      body: {
        cron: '0 2 * * *',
        input: { test: true },
      },
    })
    
    expect(response.id).toBeDefined()
    expect(response.schedule.cron).toBe('0 2 * * *')
  })
  
  it('should list scheduled flows', async () => {
    const schedules = await $fetch('/api/_flows/test-flow/schedules')
    expect(Array.isArray(schedules)).toBe(true)
  })
  
  it('should delete a schedule', async () => {
    const result = await $fetch('/api/_flows/test-flow/schedules/key123', {
      method: 'DELETE',
    })
    expect(result.success).toBe(true)
  })
})
```

## Best Practices

1. **Use descriptive names**: Add metadata descriptions for all schedules
2. **Monitor executions**: Watch flow runs to ensure schedules are working
3. **Test patterns**: Verify cron patterns match intended schedule
4. **Clean up**: Remove unused schedules to reduce Redis memory
5. **Document schedules**: Keep external documentation of critical schedules
6. **Time zones**: Remember BullMQ uses server timezone (configure in options)

## Resources

- [BullMQ Repeatable Jobs](https://docs.bullmq.io/guide/jobs/repeatable)
- [Cron Pattern Reference](https://crontab.guru/)
- [BullMQ Queue API](https://api.docs.bullmq.io/classes/Queue.html)

---

**Version**: v0.4.x  
**Status**: ✅ Ready for Implementation  
**Deprecation**: ⚠️ Will be replaced by v0.5 trigger system
