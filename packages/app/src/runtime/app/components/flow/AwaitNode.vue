<template>
  <div
    class="px-3 py-2 rounded-lg border-2 min-w-[180px] bg-white dark:bg-gray-900 transition-all duration-300"
    :class="borderClass"
  >
    <div class="flex items-center justify-between gap-2 text-xs mb-2">
      <div class="flex items-center gap-2">
        <UIcon
          :name="getAwaitIcon(data.awaitType)"
          class="w-3.5 h-3.5"
        />
        <span class="font-medium text-gray-700 dark:text-gray-300">
          {{ data.label }}
        </span>
      </div>
      <UBadge
        :label="statusLabel"
        size="xs"
        :color="statusColor"
      />
    </div>
    <div
      v-if="data.awaitConfig"
      class="text-[10px] text-gray-500 dark:text-gray-400"
    >
      <div v-if="data.awaitType === 'time'">
        Delay: {{ formatDelay(data.awaitConfig.delay) }}
      </div>
      <div v-else-if="data.awaitType === 'event'">
        Event: {{ data.awaitConfig.event }}
      </div>
      <div v-else-if="data.awaitType === 'webhook'">
        Webhook: {{ data.awaitConfig.method || 'POST' }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from '#imports'
import { UIcon, UBadge } from '#components'

interface AwaitConfig {
  type?: 'time' | 'event' | 'webhook'
  delay?: number
  event?: string
  method?: string
  timeout?: number
}

const props = defineProps<{
  data: {
    label: string
    awaitType?: 'time' | 'event' | 'webhook'
    awaitConfig?: AwaitConfig
    status?: 'idle' | 'waiting' | 'resolved' | 'timeout'
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
      return 'border-amber-400 dark:border-amber-500 bg-amber-50 dark:bg-amber-950/20'
    case 'resolved':
      return 'border-emerald-400 dark:border-emerald-500 bg-emerald-50 dark:bg-emerald-950/20'
    case 'timeout':
      return 'border-red-400 dark:border-red-500 bg-red-50 dark:bg-red-950/20'
    default:
      return 'border-gray-300 dark:border-gray-700'
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
    default:
      return 'i-lucide-clock'
  }
}

function formatDelay(ms?: number): string {
  if (!ms) return '0ms'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`
  return `${(ms / 3600000).toFixed(1)}h`
}
</script>
