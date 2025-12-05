<template>
  <div
    class="rounded-lg border-2 w-[280px] min-h-[140px] bg-white dark:bg-gray-900 transition-all duration-300 shadow-sm flex flex-col overflow-hidden"
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
      v-if="data.awaitConfig || data.awaitData"
      class="px-3 py-2.5 flex-1 overflow-y-auto text-xs min-h-0"
    >
      <!-- Time-specific -->
      <div
        v-if="data.awaitType === 'time' && data.awaitConfig?.delay"
        class="space-y-1"
      >
        <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 items-center text-[9px]">
          <span class="text-gray-600 dark:text-gray-400 font-medium flex items-center gap-1">
            <UIcon
              name="i-lucide-timer"
              class="w-3 h-3"
            />
            Delay:
          </span>
          <span class="font-mono text-gray-900 dark:text-gray-100 text-right">{{ formatDelay(data.awaitConfig.delay) }}</span>

          <template v-if="nextTriggerTime">
            <span class="text-gray-600 dark:text-gray-400 font-medium flex items-center gap-1">
              <UIcon
                name="i-lucide-calendar-clock"
                class="w-3 h-3"
              />
              Triggers:
            </span>
            <span class="text-gray-900 dark:text-gray-100 text-right">{{ nextTriggerTime }}</span>
          </template>
        </div>
      </div>

      <!-- Event-specific -->
      <div
        v-if="data.awaitType === 'event'"
        class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 items-start text-[9px]"
      >
        <template v-if="data.awaitConfig?.event || data.awaitData?.eventName">
          <span class="text-gray-600 dark:text-gray-400 font-medium flex items-center gap-1">
            <UIcon
              name="i-lucide-zap"
              class="w-3 h-3"
            />
            Event:
          </span>
          <span class="font-mono text-gray-900 dark:text-gray-100 break-all text-right">
            {{ data.awaitData?.eventName || data.awaitConfig?.event }}
          </span>
        </template>

        <template v-if="data.awaitConfig?.filterKey || data.awaitData?.filterKey">
          <span class="text-gray-600 dark:text-gray-400 font-medium flex items-center gap-1">
            <UIcon
              name="i-lucide-filter"
              class="w-3 h-3"
            />
            Filter:
          </span>
          <span class="font-mono text-gray-900 dark:text-gray-100 text-right">
            {{ data.awaitData?.filterKey || data.awaitConfig?.filterKey }}
          </span>
        </template>
      </div>

      <!-- Webhook-specific -->
      <template v-if="data.awaitType === 'webhook'">
        <div class="space-y-1">
          <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 items-center text-[9px]">
            <span class="text-gray-600 dark:text-gray-400 font-medium flex items-center gap-1">
              <UIcon
                name="i-lucide-git-branch"
                class="w-3 h-3"
              />
              Method:
            </span>
            <div class="flex justify-end">
              <UBadge
                v-if="data.awaitConfig?.method || data.awaitData?.method"
                :label="data.awaitConfig?.method || data.awaitData?.method"
                size="xs"
                color="primary"
              />
            </div>

            <template v-if="data.awaitData?.webhookUrl">
              <span class="text-gray-600 dark:text-gray-400 font-medium flex items-center gap-1">
                <UIcon
                  name="i-lucide-link"
                  class="w-3 h-3"
                />
                URL:
              </span>
              <div class="flex items-center gap-1 justify-end min-w-0">
                <span class="font-mono text-gray-900 dark:text-gray-100 truncate text-right flex-1">
                  {{ data.awaitData.webhookUrl }}
                </span>
                <button
                  type="button"
                  class="flex-shrink-0 p-0.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
                  :title="copiedUrl === data.awaitData.webhookUrl ? 'Copied!' : 'Copy URL'"
                  @click.stop="copyToClipboard(data.awaitData.webhookUrl)"
                >
                  <UIcon
                    :name="copiedUrl === data.awaitData.webhookUrl ? 'i-lucide-check' : 'i-lucide-copy'"
                    class="w-3 h-3"
                    :class="copiedUrl === data.awaitData.webhookUrl ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-600 dark:text-gray-400'"
                  />
                </button>
              </div>
            </template>

            <template v-else-if="data.awaitConfig?.path">
              <span class="text-gray-600 dark:text-gray-400 font-medium flex items-center gap-1">
                <UIcon
                  name="i-lucide-route"
                  class="w-3 h-3"
                />
                Path:
              </span>
              <div class="font-mono text-gray-900 dark:text-gray-100 truncate text-right">
                {{ data.awaitConfig.path }}
              </div>
            </template>
          </div>
        </div>
      </template>

      <!-- Schedule-specific -->
      <div
        v-if="data.awaitType === 'schedule'"
        class="space-y-1"
      >
        <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 items-center text-[9px]">
          <template v-if="data.awaitConfig?.cron">
            <span class="text-gray-600 dark:text-gray-400 font-medium flex items-center gap-1">
              <UIcon
                name="i-lucide-calendar-cog"
                class="w-3 h-3"
              />
              Cron:
            </span>
            <span class="font-mono text-gray-900 dark:text-gray-100 text-right">{{ data.awaitConfig.cron }}</span>
          </template>

          <template v-if="cronDescription">
            <span class="text-gray-600 dark:text-gray-400 font-medium flex items-center gap-1">
              <UIcon
                name="i-lucide-repeat"
                class="w-3 h-3"
              />
              Pattern:
            </span>
            <span class="text-gray-500 dark:text-gray-400 text-right">{{ cronDescription }}</span>
          </template>

          <template v-if="nextCronTime">
            <span class="text-gray-600 dark:text-gray-400 font-medium flex items-center gap-1">
              <UIcon
                name="i-lucide-calendar-check"
                class="w-3 h-3"
              />
              Next:
            </span>
            <span class="text-gray-900 dark:text-gray-100 font-medium text-right">{{ nextCronTime }}</span>
          </template>

          <template v-if="data.awaitConfig?.timezone">
            <span class="text-gray-600 dark:text-gray-400 font-medium flex items-center gap-1">
              <UIcon
                name="i-lucide-globe"
                class="w-3 h-3"
              />
              Timezone:
            </span>
            <span class="font-mono text-gray-900 dark:text-gray-100 text-right">{{ data.awaitConfig.timezone }}</span>
          </template>
        </div>
      </div>

      <!-- Common: Timeout -->
      <div
        v-if="data.awaitConfig?.timeout || data.awaitData?.timeout"
        class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 items-center text-[9px] mt-2 pt-2 border-t border-gray-200 dark:border-gray-700"
      >
        <span class="text-gray-600 dark:text-gray-400 font-medium flex items-center gap-1">
          <UIcon
            name="i-lucide-hourglass"
            class="w-3 h-3"
          />
          Timeout:
        </span>
        <span class="text-gray-900 dark:text-gray-100 text-right">
          {{ formatDelay(data.awaitData?.timeout || data.awaitConfig?.timeout) }}
        </span>
        <template v-if="data.awaitConfig?.timeoutAction || data.awaitData?.timeoutAction">
          <span class="text-gray-600 dark:text-gray-400 font-medium flex items-center gap-1">
            <UIcon
              name="i-lucide-shield-alert"
              class="w-3 h-3"
            />
            Action:
          </span>
          <span class="text-gray-900 dark:text-gray-100 text-right">
            {{ data.awaitData?.timeoutAction || data.awaitConfig?.timeoutAction }}
          </span>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from '#imports'

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

interface AwaitData {
  method?: string
  webhookUrl?: string
  timeout?: number
  timeoutAction?: string
  eventName?: string
  filterKey?: string
  [key: string]: any
}

const props = defineProps<{
  data: {
    label: string
    awaitType?: 'time' | 'event' | 'webhook' | 'schedule'
    awaitConfig?: AwaitConfig
    awaitData?: AwaitData // Runtime data from backend (includes resolved values like webhookUrl, timeout with defaults)
    status?: 'idle' | 'waiting' | 'resolved' | 'timeout'
    startedAt?: string | Date // When the await started
    scheduledTriggerAt?: string | Date // When the await is scheduled to trigger (from backend)
  }
}>()

// Copy to clipboard functionality
const copiedUrl = ref<string | null>(null)

const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)
    copiedUrl.value = text
    setTimeout(() => {
      copiedUrl.value = null
    }, 2000)
  }
  catch (err) {
    console.error('Failed to copy:', err)
  }
}

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
