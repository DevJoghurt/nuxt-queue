<template>
  <div class="flex flex-col h-full">
    <!-- Filter Bar -->
    <div class="flex items-center gap-3 px-6 py-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 shrink-0">
      <div class="flex items-center gap-2">
        <span class="text-xs font-medium text-gray-700 dark:text-gray-300">Show:</span>
        <URadioGroup
          v-model="filter"
          :items="filterOptions"
          orientation="horizontal"
          size="xs"
          variant="table"
          indicator="hidden"
          :ui="{
            base: 'size-2',
            container: 'h-2',
            item: 'p-1'
          }"
        />
      </div>

      <div class="flex items-center gap-2 ml-auto">
        <UButton
          size="xs"
          color="neutral"
          variant="outline"
          :disabled="filteredItems.length === 0"
          @click="$emit('export')"
        >
          Export JSON
        </UButton>
        <div class="text-xs text-gray-500">
          {{ filteredItems.length }} item{{ filteredItems.length === 1 ? '' : 's' }}
        </div>
      </div>
    </div>

    <!-- Combined Timeline/Logs Content -->
    <div class="flex-1 overflow-y-auto overflow-x-hidden">
      <div
        v-if="filteredItems.length === 0"
        class="h-full flex flex-col items-center justify-center text-gray-400 dark:text-gray-500"
      >
        <UIcon
          name="i-lucide-inbox"
          class="w-12 h-12 mb-3 opacity-50"
        />
        <span class="text-sm">No {{ filter === 'all' ? 'items' : filter }} yet.</span>
      </div>
      <TimelineList
        v-else
        :items="filteredItems"
        height-class="min-h-full"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from '#imports'
import TimelineList from './TimelineList.vue'
import { UButton, UIcon, URadioGroup } from '#components'

const props = defineProps<{
  events: any[]
  logs: any[]
  isLive?: boolean
}>()

defineEmits<{
  export: []
}>()

// Filter state: 'all', 'events', 'logs'
const filter = ref<'all' | 'events' | 'logs'>('all')

// Filter options for radio group
const filterOptions = [
  { value: 'all', label: 'All' },
  { value: 'events', label: 'Events' },
  { value: 'logs', label: 'Logs' },
]

// Helper function to create a unique hash for an item
function getItemHash(item: any): string {
  // For log events, use message + timestamp + stepName
  if (item.type === 'log') {
    const message = item.data?.message || item.data?.msg || ''
    const level = item.data?.level || 'info'
    const step = item.stepName || item.data?.stepName || ''
    const ts = item.ts || 0
    return `log-${ts}-${step}-${level}-${message}`.toLowerCase()
  }
  
  // For other events, use type + timestamp + stepName
  const step = item.stepName || ''
  const ts = item.ts || 0
  return `${item.type}-${ts}-${step}`.toLowerCase()
}

// Combine and filter items based on selection
const filteredItems = computed(() => {
  // First, combine ALL items (events and logs) and deduplicate
  const allItems: any[] = []
  
  // Add all events from events array
  allItems.push(...props.events)
  
  // Add logs (convert log format to event format)
  const logItems = props.logs.map(log => ({
    id: `log-${log.ts}`,
    ts: log.ts,
    type: 'log',
    stepName: log.step || log.stepName,
    data: {
      level: log.level,
      message: log.msg || log.message,
      ...log.data,
    },
  }))
  allItems.push(...logItems)
  
  // Remove duplicates using content-based hashing
  const seenHashes = new Set<string>()
  const uniqueItems: any[] = []
  
  allItems.forEach((item) => {
    const hash = getItemHash(item)
    if (!seenHashes.has(hash)) {
      seenHashes.add(hash)
      uniqueItems.push(item)
    }
  })
  
  // Now apply the filter based on selection
  let deduplicatedItems = uniqueItems
  if (filter.value === 'events') {
    // Only show non-log events
    deduplicatedItems = uniqueItems.filter(item => item.type !== 'log')
  }
  else if (filter.value === 'logs') {
    // Only show log events
    deduplicatedItems = uniqueItems.filter(item => item.type === 'log')
  }
  // 'all' shows everything (no filtering needed)
  
  // Sort by timestamp (newest first)
  deduplicatedItems.sort((a, b) => {
    const getTs = (item: any) => {
      if (typeof item.ts === 'number') return item.ts
      if (typeof item.ts === 'string') return new Date(item.ts).getTime()
      return 0
    }
    return getTs(b) - getTs(a)
  })
  
  return deduplicatedItems
})
</script>
