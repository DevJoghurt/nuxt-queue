<template>
  <div
    class="rounded-lg border-2 w-[260px] h-[120px] bg-white dark:bg-gray-900 transition-all duration-300 shadow-sm flex flex-col overflow-hidden"
    :class="borderClass"
  >
    <!-- Header -->
    <div class="px-2.5 py-1.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex-shrink-0">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-1.5 min-w-0">
          <UIcon
            :name="getAwaitIcon(data.awaitType)"
            :class="iconColorClass"
            class="w-4 h-4 flex-shrink-0"
          />
          <span class="font-semibold text-xs text-gray-700 dark:text-gray-300 uppercase tracking-wide truncate">
            {{ data.awaitType }}
          </span>
        </div>
        <UBadge
          :label="statusLabel"
          size="xs"
          :color="statusColor"
        />
      </div>
    </div>

    <!-- Body - Configuration Details -->
    <div
      v-if="data.awaitConfig"
      class="px-2.5 py-1.5 flex-1 overflow-y-auto text-xs min-h-0"
    >
      <!-- Time-specific -->
      <div v-if="data.awaitType === 'time' && data.awaitConfig.delay" class="space-y-1">
        <div class="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
          <UIcon name="i-lucide-timer" class="w-3.5 h-3.5" />
          <span class="font-medium text-[10px]">Delay:</span>
          <span class="font-mono text-gray-900 dark:text-gray-100">{{ formatDelay(data.awaitConfig.delay) }}</span>
        </div>
        <div v-if="nextTriggerTime" class="text-[10px] text-gray-500 dark:text-gray-400 pl-5">
          → {{ nextTriggerTime }}
        </div>
      </div>

      <!-- Event-specific -->
      <template v-if="data.awaitType === 'event'">
        <div v-if="data.awaitConfig.event" class="space-y-0.5">
          <div class="flex items-center gap-1 text-gray-600 dark:text-gray-400">
            <UIcon name="i-lucide-zap" class="w-3 h-3" />
            <span class="font-medium text-[9px]">Event:</span>
          </div>
          <div class="font-mono text-[9px] text-gray-900 dark:text-gray-100 break-all pl-4">
            {{ data.awaitConfig.event }}
          </div>
        </div>
        <div v-if="data.awaitConfig.filterKey" class="space-y-0.5">
          <div class="flex items-center gap-1 text-gray-600 dark:text-gray-400">
            <UIcon name="i-lucide-filter" class="w-3 h-3" />
            <span class="font-medium text-[9px]">Filter:</span>
            <span class="font-mono text-gray-900 dark:text-gray-100">{{ data.awaitConfig.filterKey }}</span>
          </div>
        </div>
      </template>

      <!-- Webhook-specific -->
      <template v-if="data.awaitType === 'webhook'">
        <div class="space-y-0.5">
          <div class="flex items-center gap-1 text-gray-600 dark:text-gray-400">
            <UIcon name="i-lucide-send" class="w-3 h-3" />
            <span class="font-medium text-[9px]">Method:</span>
            <UBadge v-if="data.awaitConfig.method" :label="data.awaitConfig.method" size="xs" color="primary" />
          </div>
          <div v-if="data.awaitConfig.path" class="flex items-start gap-1 text-gray-600 dark:text-gray-400">
            <UIcon name="i-lucide-link" class="w-3 h-3 mt-0.5 flex-shrink-0" />
            <div class="flex-1 min-w-0">
              <span class="font-medium text-[9px]">Path:</span>
              <div class="font-mono text-[9px] text-gray-900 dark:text-gray-100 break-all">
                {{ data.awaitConfig.path }}
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- Schedule-specific -->
      <template v-if="data.awaitType === 'schedule'">
        <div v-if="data.awaitConfig.cron" class="space-y-0.5">
          <div class="flex items-center gap-1 text-gray-600 dark:text-gray-400">
            <UIcon name="i-lucide-calendar-clock" class="w-3 h-3" />
            <span class="font-medium text-[9px]">Cron:</span>
            <span class="font-mono text-[9px] text-gray-900 dark:text-gray-100">{{ data.awaitConfig.cron }}</span>
          </div>
          <div v-if="cronDescription" class="text-[9px] text-gray-500 dark:text-gray-400 pl-4">
            {{ cronDescription }}
          </div>
        </div>
        <div v-if="nextCronTime" class="flex items-center gap-1 text-gray-600 dark:text-gray-400">
          <UIcon name="i-lucide-clock-3" class="w-3 h-3" />
          <span class="font-medium text-[9px]">Next:</span>
          <span class="text-[9px] text-gray-900 dark:text-gray-100 font-medium">{{ nextCronTime }}</span>
        </div>
        <div v-if="data.awaitConfig.timezone" class="flex items-center gap-1 text-gray-600 dark:text-gray-400">
          <UIcon name="i-lucide-globe" class="w-3 h-3" />
          <span class="font-mono text-[9px] text-gray-900 dark:text-gray-100">{{ data.awaitConfig.timezone }}</span>
        </div>
      </template>

      <!-- Common: Timeout -->
      <div v-if="data.awaitConfig.timeout" class="flex items-center gap-1 text-gray-600 dark:text-gray-400 pt-0.5 border-t border-gray-200 dark:border-gray-700">
        <UIcon name="i-lucide-hourglass" class="w-3 h-3" />
        <span class="font-medium text-[9px]">Timeout:</span>
        <span class="text-[9px] text-gray-900 dark:text-gray-100">
          {{ formatDelay(data.awaitConfig.timeout) }}
        </span>
        <span v-if="data.awaitConfig.timeoutAction" class="text-[9px] text-gray-500 dark:text-gray-400">
          ({{ data.awaitConfig.timeoutAction }})
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from '#imports'

interface AwaitConfig {
  type?: 'time' | 'event' | 'webhook' | 'schedule'
  delay?: number
  event?: string
  filterKey?: string
  method?: string
  path?: string
  cron?: string
  timezone?: string
  timeout?: number
  timeoutAction?: 'fail' | 'continue' | 'retry'
}

const props = defineProps<{
  data: {
    label: string
    awaitType?: 'time' | 'event' | 'webhook' | 'schedule'
    awaitConfig?: AwaitConfig
    status?: 'idle' | 'waiting' | 'resolved' | 'timeout'
    startedAt?: string | Date // When the await started
    scheduledTriggerAt?: string | Date // When the await is scheduled to trigger (from backend)
  }
}>()

const statusLabel = computed(() => {
  return (props.data.status || 'idle').toUpperCase()
})

const statusColor = computed(() => {
  switch (props.data.status) {
    case 'waiting':
      return 'warning'
    case 'resolved':
      return 'success'
    case 'timeout':
      return 'error'
    default:
      return 'neutral'
  }
})

const borderClass = computed(() => {
  switch (props.data.status) {
    case 'waiting':
      return 'border-amber-400 dark:border-amber-500'
    case 'resolved':
      return 'border-emerald-400 dark:border-emerald-500'
    case 'timeout':
      return 'border-red-400 dark:border-red-500'
    default:
      return 'border-blue-300 dark:border-blue-700'
  }
})

const iconColorClass = computed(() => {
  switch (props.data.awaitType) {
    case 'time':
      return 'text-blue-600 dark:text-blue-400'
    case 'event':
      return 'text-purple-600 dark:text-purple-400'
    case 'webhook':
      return 'text-orange-600 dark:text-orange-400'
    case 'schedule':
      return 'text-green-600 dark:text-green-400'
    default:
      return 'text-gray-600 dark:text-gray-400'
  }
})

function getAwaitIcon(type?: string): string {
  switch (type) {
    case 'time':
      return 'i-lucide-clock'
    case 'event':
      return 'i-lucide-zap'
    case 'webhook':
      return 'i-lucide-webhook'
    case 'schedule':
      return 'i-lucide-calendar-clock'
    default:
      return 'i-lucide-clock'
  }
}

function formatDelay(ms?: number): string {
  if (!ms) return '0ms'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 60000 * 60) return `${(ms / 60000).toFixed(1)}m`
  if (ms < 60000 * 60 * 24) return `${(ms / 3600000).toFixed(1)}h`
  return `${(ms / (3600000 * 24)).toFixed(1)}d`
}

// Display trigger time for time-based awaits
const nextTriggerTime = computed(() => {
  if (props.data.awaitType !== 'time' || !props.data.awaitConfig?.delay) return null
  
  // Use scheduled trigger time from backend if available
  if (props.data.scheduledTriggerAt) {
    const triggerTime = new Date(props.data.scheduledTriggerAt)
    if (!Number.isNaN(triggerTime.getTime())) {
      return triggerTime.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    }
  }
  
  return 'No schedule'
})

// Parse cron expression to human-readable format
const cronDescription = computed(() => {
  if (props.data.awaitType !== 'schedule' || !props.data.awaitConfig?.cron) return null

  const cron = props.data.awaitConfig.cron
  const parts = cron.split(' ')

  // One-time schedule descriptions (next occurrence only)
  if (cron === '* * * * *') return 'Next minute'
  if (cron === '0 * * * *') return 'Top of next hour'
  if (cron === '0 0 * * *') return 'Next midnight'
  if (cron === '0 9 * * *') return 'Next 9:00 AM'
  if (cron === '0 0 * * 0') return 'Next Sunday midnight'
  if (cron === '0 0 1 * *') return 'Next 1st of month'

  // Parse basic patterns (one-time trigger)
  try {
    if (parts.length >= 5) {
      const minute = parts[0] || '*'
      const hour = parts[1] || '*'
      const day = parts[2] || '*'
      const month = parts[3] || '*'
      const weekday = parts[4] || '*'

      // Next occurrence at specific interval
      if (minute.startsWith('*/') && hour === '*') {
        return `Next ${minute.slice(2)}min mark`
      }

      // Next specific time
      if (minute !== '*' && hour !== '*' && day === '*' && month === '*' && weekday === '*') {
        return `Next ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
      }
    }
  }
  catch {
    // Ignore parsing errors
  }

  return `Next: ${cron}`
})

// Display scheduled cron trigger time
const nextCronTime = computed(() => {
  if (props.data.awaitType !== 'schedule' || !props.data.awaitConfig?.cron) return null

  // Use scheduled trigger time from backend if available
  if (props.data.scheduledTriggerAt) {
    const triggerTime = new Date(props.data.scheduledTriggerAt)
    if (!Number.isNaN(triggerTime.getTime())) {
      return triggerTime.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
      })
    }
  }

  return 'No schedule'
})
</script>
