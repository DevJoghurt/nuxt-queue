<template>
  <div
    :class="heightClass"
    class="overflow-y-auto overflow-x-hidden"
  >
    <UTimeline
      v-if="timelineItems && timelineItems.length"
      :items="timelineItems"
      size="xs"
      class="px-6 py-4"
    >
      <!-- Custom indicator slot to show icons -->
      <template #indicator="{ item }">
        <UIcon
          :name="item.icon || 'i-lucide-circle'"
          class="size-4"
        />
      </template>

      <!-- Custom title slot to include kind badge and subject -->
      <template #title="{ item }">
        <div class="flex items-center gap-2 min-w-0">
          <span
            class="font-mono text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 flex-shrink-0"
          >
            {{ item.eventType }}
          </span>
          <span
            v-if="item.stepName"
            class="text-xs text-gray-500 dark:text-gray-400 truncate"
          >
            {{ item.stepName }}
          </span>
        </div>
      </template>

      <!-- Custom description slot for rich content -->
      <template #description="{ item }">
        <!-- Special rendering for log events -->
        <div
          v-if="item.eventType === 'log'"
          class="space-y-2 mt-2"
        >
          <div class="flex items-start gap-2">
            <UBadge
              :color="levelColor(item?.eventData?.level)"
              variant="subtle"
              size="xs"
              class="capitalize mt-0.5 flex-shrink-0"
            >
              {{ item?.eventData?.level || 'info' }}
            </UBadge>
            <span class="text-sm text-gray-900 dark:text-gray-100 flex-1 break-words">
              {{ item?.eventData?.message || '' }}
            </span>
          </div>
          <div
            v-if="item?.eventData?.progress"
            class="mt-2"
          >
            <pre class="text-xs bg-gray-50 dark:bg-gray-800 rounded p-2 overflow-y-auto max-h-40 text-gray-700 dark:text-gray-300 font-mono whitespace-pre-wrap break-words">{{ pretty(item.eventData) }}</pre>
          </div>
        </div>

        <!-- Special rendering for await events -->
        <div
          v-else-if="isAwaitEvent(item.eventType)"
          class="text-sm mt-2"
        >
          <div
            v-if="item.eventData"
            class="space-y-1"
          >
            <div
              v-if="item.eventData.awaitType"
              class="flex items-start gap-2"
            >
              <span class="text-xs text-gray-500 dark:text-gray-400 font-medium min-w-[60px] flex-shrink-0">Type:</span>
              <UBadge color="blue" variant="subtle" size="xs" class="capitalize">
                {{ item.eventData.awaitType }}
              </UBadge>
            </div>
            <div
              v-if="item.eventData.position"
              class="flex items-start gap-2"
            >
              <span class="text-xs text-gray-500 dark:text-gray-400 font-medium min-w-[60px] flex-shrink-0">Position:</span>
              <UBadge color="neutral" variant="subtle" size="xs" class="capitalize">
                {{ item.eventData.position }}
              </UBadge>
            </div>
            <div
              v-if="item.eventData.triggerName"
              class="flex items-start gap-2"
            >
              <span class="text-xs text-gray-500 dark:text-gray-400 font-medium min-w-[60px] flex-shrink-0">Trigger:</span>
              <span class="text-xs text-gray-700 dark:text-gray-300 font-mono">{{ item.eventData.triggerName }}</span>
            </div>
            <div
              v-if="item.eventData.triggerData"
              class="flex items-start gap-2"
            >
              <span class="text-xs text-gray-500 dark:text-gray-400 font-medium min-w-[60px] flex-shrink-0">Data:</span>
              <pre class="text-xs bg-gray-50 dark:bg-gray-800 rounded px-2 py-1 overflow-y-auto max-h-20 text-gray-700 dark:text-gray-300 font-mono flex-1 min-w-0 whitespace-pre-wrap break-words">{{ pretty(item.eventData.triggerData) }}</pre>
            </div>
            <div
              v-if="item.eventData.duration"
              class="flex items-start gap-2"
            >
              <span class="text-xs text-gray-500 dark:text-gray-400 font-medium min-w-[60px] flex-shrink-0">Duration:</span>
              <span class="text-xs text-gray-700 dark:text-gray-300">{{ item.eventData.duration }}ms</span>
            </div>
          </div>
        </div>

        <!-- Special rendering for flow events -->
        <div
          v-else-if="isFlowEvent(item.eventType)"
          class="text-sm mt-2"
        >
          <div
            v-if="item.eventData"
            class="space-y-1"
          >
            <div
              v-if="item.eventData.input"
              class="flex items-start gap-2"
            >
              <span class="text-xs text-gray-500 dark:text-gray-400 font-medium min-w-[60px] flex-shrink-0">Input:</span>
              <pre class="text-xs bg-gray-50 dark:bg-gray-800 rounded px-2 py-1 overflow-y-auto max-h-20 text-gray-700 dark:text-gray-300 font-mono flex-1 min-w-0 whitespace-pre-wrap break-words">{{ pretty(item.eventData.input) }}</pre>
            </div>
            <div
              v-if="item.eventData.output"
              class="flex items-start gap-2"
            >
              <span class="text-xs text-gray-500 dark:text-gray-400 font-medium min-w-[60px] flex-shrink-0">Output:</span>
              <pre class="text-xs bg-gray-50 dark:bg-gray-800 rounded px-2 py-1 overflow-y-auto max-h-20 text-gray-700 dark:text-gray-300 font-mono flex-1 min-w-0 whitespace-pre-wrap break-words">{{ pretty(item.eventData.output) }}</pre>
            </div>
            <div
              v-if="item.eventData.error"
              class="flex items-start gap-2"
            >
              <span class="text-xs text-red-500 dark:text-red-400 font-medium min-w-[60px] flex-shrink-0">Error:</span>
              <pre class="text-xs bg-red-50 dark:bg-red-900/20 rounded px-2 py-1 overflow-y-auto max-h-20 text-red-700 dark:text-red-300 font-mono flex-1 min-w-0 whitespace-pre-wrap break-words">{{ pretty(item.eventData.error) }}</pre>
            </div>
          </div>
        </div>

        <!-- Default rendering -->
        <div
          v-else-if="item.eventData && Object.keys(item.eventData).length > 0"
          class="mt-2"
        >
          <pre class="text-xs bg-gray-50 dark:bg-gray-800 rounded p-2 overflow-y-auto max-h-40 text-gray-700 dark:text-gray-300 font-mono whitespace-pre-wrap break-words">{{ pretty(item.eventData) }}</pre>
        </div>
      </template>
    </UTimeline>
    <div
      v-else
      class="h-full w-full flex flex-col items-center justify-center text-gray-400 dark:text-gray-500"
    >
      <UIcon
        name="i-lucide-inbox"
        class="w-12 h-12 mb-3 opacity-50"
      />
      <span class="text-sm">No events yet.</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from '#imports'
import type { TimelineItem } from '@nuxt/ui'
import { UTimeline, UIcon, UBadge } from '#components'

const props = defineProps<{ items: any[], heightClass?: string }>()

const heightClass = computed(() => props.heightClass || 'h-96')

function eventTsMs(e: any): number {
  try {
    const ts = (e as any)?.ts
    if (typeof ts === 'number' && Number.isFinite(ts)) return ts
    if (typeof ts === 'string') {
      const n = Number(ts)
      if (Number.isFinite(n)) return n
      const d = Date.parse(ts)
      if (!Number.isNaN(d)) return d
    }
    if (typeof e?.id === 'string' && e.id.includes('-')) {
      const n = Number(e.id.split('-')[0])
      if (Number.isFinite(n)) return n
    }
  }
  catch {
    // ignore
  }
  return Date.now()
}

function formatTs(e: any) {
  try {
    const t = eventTsMs(e)
    return new Date(t).toLocaleString()
  }
  catch {
    return ''
  }
}

function eventIcon(type: string) {
  if (!type) return 'i-lucide-circle'

  // Flow events
  if (type === 'flow.start') return 'i-lucide-play-circle'
  if (type === 'flow.completed') return 'i-lucide-check-circle-2'
  if (type === 'flow.failed') return 'i-lucide-x-circle'
  if (type === 'flow.cancel') return 'i-lucide-ban'

  // Step events
  if (type === 'step.started' || type === 'step.running') return 'i-lucide-arrow-right-circle'
  if (type === 'step.completed') return 'i-lucide-check-circle'
  if (type === 'step.failed') return 'i-lucide-alert-circle'
  if (type === 'step.retry') return 'i-lucide-rotate-cw'
  if (type === 'step.timeout') return 'i-lucide-clock'

  // Await events
  if (type === 'await.registered') return 'i-lucide-timer'
  if (type === 'await.resolved') return 'i-lucide-check-circle'
  if (type === 'await.timeout') return 'i-lucide-clock-alert'

  // Log events
  if (type === 'log') return 'i-lucide-file-text'

  // Emit events
  if (type === 'emit') return 'i-lucide-zap'

  // Default
  return 'i-lucide-circle-dot'
}

// Convert raw events to timeline items
const timelineItems = computed(() => {
  const arr = Array.isArray(props.items) ? [...props.items] : []

  // Sort newest first
  arr.sort((a, b) => {
    const tb = eventTsMs(b)
    const ta = eventTsMs(a)
    if (tb !== ta) return tb - ta
    // fallback stable by id string desc
    const ai = String((a as any)?.id || '')
    const bi = String((b as any)?.id || '')
    return bi.localeCompare(ai)
  })

  // Map to timeline item format
  return arr.map(e => ({
    date: formatTs(e),
    icon: eventIcon(e.type),
    eventType: e.type,
    stepName: e.stepName,
    eventData: e.data,
  } as TimelineItem & { eventType: string, stepName?: string, eventData?: any }))
})

function pretty(v: any) {
  try {
    return JSON.stringify(v, null, 2)
  }
  catch {
    return String(v)
  }
}

function levelColor(level?: string) {
  switch ((level || '').toLowerCase()) {
    case 'debug': return 'neutral'
    case 'info': return 'primary'
    case 'warn': return 'warning'
    case 'error': return 'error'
    default: return 'neutral'
  }
}

function isFlowEvent(type: string) {
  return type?.startsWith('flow.') || type?.startsWith('step.')
}

function isAwaitEvent(type: string) {
  return type?.startsWith('await.')
}
</script>

<style scoped>
</style>
