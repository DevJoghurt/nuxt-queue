<template>
  <div class="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4">
    <div class="flex items-center gap-3">
      <div
        class="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
        :class="iconBackgroundClass"
      >
        <UIcon
          :name="icon"
          class="w-5 h-5"
          :class="iconColorClass"
        />
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {{ count }}
        </p>
        <p class="text-xs text-gray-500 dark:text-gray-400">
          {{ label }}
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from '#imports'
import { UIcon } from '#components'

interface Props {
  icon: string
  count: number | string
  label: string
  variant?: 'gray' | 'blue' | 'amber' | 'emerald' | 'red' | 'purple'
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'gray',
})

const iconBackgroundClass = computed(() => {
  const variants = {
    gray: 'bg-gray-50 dark:bg-gray-800',
    blue: 'bg-blue-50 dark:bg-blue-950/30',
    amber: 'bg-amber-50 dark:bg-amber-950/30',
    emerald: 'bg-emerald-50 dark:bg-emerald-950/30',
    red: 'bg-red-50 dark:bg-red-950/30',
    purple: 'bg-purple-50 dark:bg-purple-950/30',
  }
  return variants[props.variant]
})

const iconColorClass = computed(() => {
  const variants = {
    gray: 'text-gray-600 dark:text-gray-400',
    blue: 'text-blue-600 dark:text-blue-400',
    amber: 'text-amber-600 dark:text-amber-400',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    red: 'text-red-600 dark:text-red-400',
    purple: 'text-purple-600 dark:text-purple-400',
  }
  return variants[props.variant]
})
</script>
