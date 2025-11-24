<template>
  <div
    class="flex items-center gap-1.5 px-1.5 py-0.5 rounded text-xs border shrink-0"
    :class="{
      'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800': isCompleted,
      'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800': isFailed,
      'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800': isRunning,
      'bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800': isAwaiting,
      'bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800': isCanceled,
      'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800': isStalled,
      'bg-gray-50 dark:bg-gray-900/30 border-gray-200 dark:border-gray-800': isIdle,
    }"
  >
    <div
      class="w-1 h-1 rounded-full"
      :class="{
        'bg-emerald-500': isCompleted,
        'bg-red-500': isFailed,
        'bg-blue-500 animate-pulse': isRunning && !isReconnecting,
        'bg-purple-500 animate-pulse': isAwaiting,
        'bg-amber-500 animate-pulse': isReconnecting,
        'bg-orange-500': isCanceled,
        'bg-amber-600': isStalled,
        'bg-gray-400': isIdle,
      }"
    />
    <span
      class="text-[10px] font-medium uppercase tracking-wider"
      :class="{
        'text-emerald-700 dark:text-emerald-400': isCompleted,
        'text-red-700 dark:text-red-400': isFailed,
        'text-blue-700 dark:text-blue-400': isRunning,
        'text-purple-700 dark:text-purple-400': isAwaiting,
        'text-orange-700 dark:text-orange-400': isCanceled,
        'text-amber-700 dark:text-amber-400': isStalled,
        'text-gray-600 dark:text-gray-400': isIdle,
      }"
    >
      <template v-if="isReconnecting">
        Reconnecting
      </template>
      <template v-else-if="isRunning">
        Running
      </template>
      <template v-else-if="isAwaiting">
        Awaiting
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
      <template v-else-if="isStalled">
        Stalled
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
  isStalled?: boolean
  isAwaiting?: boolean
  isReconnecting?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  isRunning: false,
  isCompleted: false,
  isFailed: false,
  isCanceled: false,
  isStalled: false,
  isAwaiting: false,
  isReconnecting: false,
})

const isIdle = computed(() => {
  return !props.isRunning && !props.isCompleted && !props.isFailed && !props.isCanceled && !props.isStalled && !props.isAwaiting
})
</script>
