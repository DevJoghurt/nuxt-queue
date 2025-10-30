<template>
  <div class="py-6 space-y-4">
    <div class="flex items-center gap-2 flex-wrap">
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

    <TimelineList
      :items="events"
      height-class="h-[calc(100vh-300px)]"
    />
  </div>
</template>

<script setup lang="ts">
import TimelineList from './TimelineList.vue'

defineProps<{
  events: any[]
  isLive?: boolean
}>()

defineEmits<{
  export: []
  clear: []
}>()
</script>
