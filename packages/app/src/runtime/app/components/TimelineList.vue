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
            :class="eventTypeColor(item.eventType)"
            class="font-mono text-xs px-2 py-1 rounded font-medium flex-shrink-0"
          >
            {{ item.eventType }}
          </span>
          <span
            v-if="item.stepName"
            class="text-xs text-gray-600 dark:text-gray-300 truncate"
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
          :class="hasMetadata(item.eventData) ? 'p-3 rounded-lg border bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 mt-2' : 'mt-1'"
          class="space-y-2"
        >
          <div class="flex items-start gap-2">
            <UBadge
              :color="levelColor(item?.eventData?.level)"
              variant="solid"
              size="xs"
              class="capitalize mt-0.5 flex-shrink-0"
            >
              {{ item?.eventData?.level || 'info' }}
            </UBadge>
            <span class="text-xs text-gray-900 dark:text-gray-100 flex-1 break-words line-clamp-3">
              {{ item?.eventData?.message || '' }}
            </span>
          </div>
          <!-- Show metadata in accordion if exists -->
          <div v-if="hasMetadata(item.eventData)">
            <UAccordion
              :items="[{
                label: 'Metadata',
                icon: 'i-lucide-info',
                defaultOpen: false,
                content: item.eventData,
              }]"
              :ui="{
                trigger: 'text-[10px] py-1',
                leadingIcon: 'size-3 text-blue-500 dark:text-blue-400',
                label: 'text-[10px]',
                item: 'border-0 mt-1',
              }"
            >
              <template #content="{ item: accordionItem }">
                <pre class="text-xs bg-gray-50 dark:bg-gray-800 rounded p-2 overflow-y-auto max-h-60 text-gray-700 dark:text-gray-300 font-mono whitespace-pre-wrap break-words">{{ prettyMetadata(accordionItem.content) }}</pre>
              </template>
            </UAccordion>
          </div>
        </div>

        <!-- Special rendering for await events -->
        <div
          v-else-if="isAwaitEvent(item.eventType)"
          class="text-sm mt-2"
        >
          <div
            v-if="item.eventData"
            class="space-y-1 p-2 rounded border bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700"
          >
            <div
              v-if="item.eventData.awaitType"
              class="flex items-start gap-2"
            >
              <span class="text-xs text-gray-500 dark:text-gray-400 min-w-[60px] flex-shrink-0">Type:</span>
              <UBadge
                color="blue"
                variant="subtle"
                size="xs"
                class="capitalize"
              >
                {{ item.eventData.awaitType }}
              </UBadge>
            </div>
            <div
              v-if="item.eventData.position"
              class="flex items-start gap-2"
            >
              <span class="text-xs text-gray-500 dark:text-gray-400 min-w-[60px] flex-shrink-0">Position:</span>
              <UBadge
                color="neutral"
                variant="subtle"
                size="xs"
                class="capitalize"
              >
                {{ item.eventData.position }}
              </UBadge>
            </div>
            <div
              v-if="item.eventData.triggerName"
              class="flex items-start gap-2"
            >
              <span class="text-xs text-gray-600 dark:text-gray-300 font-semibold min-w-[60px] flex-shrink-0">Trigger:</span>
              <span class="text-xs text-gray-700 dark:text-gray-300 font-mono">{{ item.eventData.triggerName }}</span>
            </div>
            <div
              v-if="item.eventData.triggerData"
              class="mt-1"
            >
              <UAccordion
                :items="[{
                  label: 'Trigger Data',
                  icon: 'i-lucide-braces',
                  defaultOpen: false,
                  content: item.eventData.triggerData,
                }]"
                :ui="{
                  trigger: 'text-[10px] py-1',
                  leadingIcon: 'size-3 text-purple-500 dark:text-purple-400',
                  label: 'text-[10px]',
                  item: 'border-0 mt-0',
                }"
              >
                <template #content="{ item: accordionItem }">
                  <pre class="text-xs bg-gray-50 dark:bg-gray-800 rounded p-2 overflow-y-auto max-h-60 text-gray-700 dark:text-gray-300 font-mono whitespace-pre-wrap break-words">{{ pretty(accordionItem.content) }}</pre>
                </template>
              </UAccordion>
            </div>
            <div
              v-if="item.eventData.duration"
              class="flex items-start gap-2"
            >
              <span class="text-xs text-gray-600 dark:text-gray-300 font-semibold min-w-[60px] flex-shrink-0">Duration:</span>
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
            v-if="item.eventData && (item.eventData.input || item.eventData.output || item.eventData.error)"
            class="space-y-1 p-2 rounded border bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700"
          >
            <div
              v-if="item.eventData.input"
              class="mt-1"
            >
              <UAccordion
                :items="[{
                  label: 'Input',
                  icon: 'i-lucide-arrow-down-to-line',
                  defaultOpen: false,
                  content: item.eventData.input,
                }]"
                :ui="{
                  trigger: 'text-[10px] py-1',
                  leadingIcon: 'size-3 text-green-500 dark:text-green-400',
                  label: 'text-[10px]',
                  item: 'border-0 mt-0',
                }"
              >
                <template #content="{ item: accordionItem }">
                  <pre class="text-xs bg-gray-50 dark:bg-gray-800 rounded p-2 overflow-y-auto max-h-60 text-gray-700 dark:text-gray-300 font-mono whitespace-pre-wrap break-words">{{ pretty(accordionItem.content) }}</pre>
                </template>
              </UAccordion>
            </div>
            <div
              v-if="item.eventData.output"
              class="mt-1"
            >
              <UAccordion
                :items="[{
                  label: 'Output',
                  icon: 'i-lucide-arrow-up-from-line',
                  defaultOpen: false,
                  content: item.eventData.output,
                }]"
                :ui="{
                  trigger: 'text-[10px] py-1',
                  leadingIcon: 'size-3 text-blue-500 dark:text-blue-400',
                  label: 'text-[10px]',
                  item: 'border-0 mt-0',
                }"
              >
                <template #content="{ item: accordionItem }">
                  <pre class="text-xs bg-gray-50 dark:bg-gray-800 rounded p-2 overflow-y-auto max-h-60 text-gray-700 dark:text-gray-300 font-mono whitespace-pre-wrap break-words">{{ pretty(accordionItem.content) }}</pre>
                </template>
              </UAccordion>
            </div>
            <div
              v-if="item.eventData.error"
              class="mt-1"
            >
              <UAccordion
                :items="[{
                  label: 'Error Details',
                  icon: 'i-lucide-alert-circle',
                  defaultOpen: true,
                  content: item.eventData.error,
                }]"
                :ui="{
                  trigger: 'text-[10px] py-1 text-red-600 dark:text-red-400',
                  leadingIcon: 'size-3 text-red-500 dark:text-red-400',
                  label: 'text-[10px]',
                  item: 'border-0 mt-0',
                }"
              >
                <template #content="{ item: accordionItem }">
                  <pre class="text-xs bg-red-50 dark:bg-red-900/20 rounded p-2 overflow-y-auto max-h-60 text-red-700 dark:text-red-300 font-mono whitespace-pre-wrap break-words">{{ pretty(accordionItem.content) }}</pre>
                </template>
              </UAccordion>
            </div>
          </div>
        </div>

        <!-- Special rendering for emit events -->
        <div
          v-else-if="isEmitEvent(item.eventType)"
          class="mt-2"
        >
          <div
            v-if="item.eventData && item.eventData.payload"
            class="p-2 rounded border bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700"
          >
            <div class="flex items-center gap-2 mb-1">
              <span class="text-xs text-gray-500 dark:text-gray-400">Event:</span>
              <UBadge
                color="primary"
                variant="solid"
                size="xs"
              >
                {{ item.eventData.name || 'unknown' }}
              </UBadge>
            </div>
            <UAccordion
              v-if="item.eventData.payload"
              :items="[{
                label: 'Payload',
                icon: 'i-lucide-package',
                defaultOpen: false,
                content: item.eventData.payload,
              }]"
              :ui="{
                trigger: 'text-[10px] py-1',
                leadingIcon: 'size-3 text-emerald-500 dark:text-emerald-400',
                label: 'text-[10px]',
                item: 'border-0 mt-0',
              }"
            >
              <template #content="{ item: accordionItem }">
                <pre class="text-xs bg-gray-50 dark:bg-gray-800 rounded p-2 overflow-y-auto max-h-60 text-gray-700 dark:text-gray-300 font-mono whitespace-pre-wrap break-words">{{ pretty(accordionItem.content) }}</pre>
              </template>
            </UAccordion>
          </div>
          <div
            v-else-if="item.eventData"
            class="flex items-center gap-2 mt-1"
          >
            <span class="text-xs text-gray-500 dark:text-gray-400">Event:</span>
            <UBadge
              color="primary"
              variant="solid"
              size="xs"
            >
              {{ item.eventData.name || 'unknown' }}
            </UBadge>
          </div>
        </div>

        <!-- Default rendering with accordion -->
        <div
          v-else-if="item.eventData && Object.keys(item.eventData).length > 0"
          class="mt-2"
        >
          <UAccordion
            :items="[{
              label: 'Event Data',
              icon: 'i-lucide-braces',
              defaultOpen: false,
              content: item.eventData,
            }]"
            :ui="{
              trigger: 'text-[10px] py-1',
              leadingIcon: 'size-3 text-gray-500 dark:text-gray-400',
              label: 'text-[10px]',
              item: 'border-0 mt-1',
            }"
          >
            <template #content="{ item: accordionItem }">
              <pre class="text-xs bg-gray-50 dark:bg-gray-800 rounded p-2 overflow-y-auto max-h-60 text-gray-700 dark:text-gray-300 font-mono whitespace-pre-wrap break-words">{{ pretty(accordionItem.content) }}</pre>
            </template>
          </UAccordion>
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

function eventTypeColor(type: string) {
  if (!type) return 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
  
  // Flow events
  if (type.startsWith('flow.')) {
    if (type === 'flow.start') return 'bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300'
    if (type === 'flow.completed') return 'bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300'
    if (type === 'flow.failed') return 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300'
    return 'bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300'
  }
  
  // Step events
  if (type.startsWith('step.')) {
    if (type === 'step.completed') return 'bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300'
    if (type === 'step.failed') return 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300'
    return 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300'
  }
  
  // Await events
  if (type.startsWith('await.')) {
    if (type === 'await.resolved') return 'bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300'
    if (type === 'await.timeout') return 'bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300'
    return 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300'
  }
  
  // Log events
  if (type === 'log') return 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-300'
  
  // Emit events
  if (type === 'emit') return 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300'
  
  // Default
  return 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
}

function isFlowEvent(type: string) {
  return type?.startsWith('flow.') || type?.startsWith('step.')
}

function isAwaitEvent(type: string) {
  return type?.startsWith('await.')
}

function isEmitEvent(type: string) {
  return type === 'emit'
}

function hasMetadata(eventData: any): boolean {
  if (!eventData || typeof eventData !== 'object') return false
  // Check if there's metadata beyond message and level for logs
  const keys = Object.keys(eventData).filter(k => k !== 'message' && k !== 'level' && k !== 'msg')
  return keys.length > 0
}

function prettyMetadata(eventData: any): string {
  if (!eventData || typeof eventData !== 'object') return ''
  // Filter out message and level for log metadata display
  const { message, level, msg, ...metadata } = eventData
  return pretty(metadata)
}
</script>

<style scoped>
</style>
