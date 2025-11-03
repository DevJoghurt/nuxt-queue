<template>
  <div class="flex flex-col h-full">
    <!-- Action Bar -->
    <div class="flex items-center gap-2 flex-wrap px-6 py-4 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50">
      <UButton
        size="xs"
        color="neutral"
        variant="outline"
        :disabled="events.length === 0"
        @click="$emit('export')"
      >
        Export JSON
      </UButton>
      <UButton
        size="xs"
        color="neutral"
        variant="outline"
        :disabled="events.length === 0 && !isLive"
        @click="$emit('clear')"
      >
        Clear
      </UButton>
      <div
        v-if="isLive"
        class="flex items-center gap-2 text-xs text-gray-500 ml-auto"
      >
        <div class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        <span>Live streaming</span>
      </div>
      <div
        v-else-if="events.length > 0"
        class="text-xs text-gray-500 ml-auto"
      >
        {{ events.length }} event{{ events.length === 1 ? '' : 's' }}
      </div>
    </div>

    <!-- Timeline Content -->
    <TimelineList
      :items="events"
      height-class="flex-1"
    />
  </div>
</template>

<script setup lang="ts">
import TimelineList from './TimelineList.vue'
import { UButton } from '#components'

defineProps<{
  events: any[]
  isLive?: boolean
}>()

defineEmits<{
  export: []
  clear: []
}>()
</script>
