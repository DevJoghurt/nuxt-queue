<template>
  <div
    class="flex items-center gap-1.5 px-1.5 py-0.5 rounded text-xs border shrink-0"
    :class="{
      'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800': isCompleted,
      'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800': isFailed,
      'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800': isRunning,
      'bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800': isCanceled,
      'bg-gray-50 dark:bg-gray-900/30 border-gray-200 dark:border-gray-800': isIdle,
    }"
  >
    <div
      class="w-1 h-1 rounded-full"
      :class="{
        'bg-emerald-500': isCompleted,
        'bg-red-500': isFailed,
        'bg-blue-500 animate-pulse': isRunning && !isReconnecting,
        'bg-amber-500 animate-pulse': isReconnecting,
        'bg-orange-500': isCanceled,
        'bg-gray-400': isIdle,
      }"
    />
    <span
      class="text-[10px] font-medium uppercase tracking-wider"
      :class="{
        'text-emerald-700 dark:text-emerald-400': isCompleted,
        'text-red-700 dark:text-red-400': isFailed,
        'text-blue-700 dark:text-blue-400': isRunning,
        'text-orange-700 dark:text-orange-400': isCanceled,
        'text-gray-600 dark:text-gray-400': isIdle,
      }"
    >
      <template v-if="isReconnecting">
        Reconnecting
      </template>
      <template v-else-if="isRunning">
        Running
      </template>
      <template v-else-if="isCompleted">
        Done
      </template>
      <template v-else-if="isFailed">
        Failed
      </template>
      <template v-else-if="isCanceled">
        Canceled
      </template>
      <template v-else>
        Idle
      </template>
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from '#imports'

interface Props {
  isRunning?: boolean
  isCompleted?: boolean
  isFailed?: boolean
  isCanceled?: boolean
  isReconnecting?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  isRunning: false,
  isCompleted: false,
  isFailed: false,
  isCanceled: false,
  isReconnecting: false,
})

const isIdle = computed(() => {
  return !props.isRunning && !props.isCompleted && !props.isFailed && !props.isCanceled
})
</script>
