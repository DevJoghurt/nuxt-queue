<template>
  <div
    v-if="isConnected"
    class="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400"
  >
    <div class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
    <span>Live</span>
  </div>
  <div
    v-else-if="isReconnecting"
    class="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400"
  >
    <div class="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
    <span>Reconnecting...</span>
  </div>
  <div
    v-else
    class="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-600"
  >
    <div class="w-2 h-2 rounded-full bg-gray-400" />
    <span>Offline</span>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  isConnected: boolean
  isReconnecting?: boolean
}>()
</script>
