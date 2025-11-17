<template>
  <div :class="ui.root">
    <button
      v-for="item in items"
      :key="item.value"
      type="button"
      :class="itemClasses(item)"
      @click="$emit('update:modelValue', item.value)"
    >
      <!-- Status Icon or All Icon -->
      <div
        class="flex-shrink-0"
        :class="item.step.showAllIndicator ? '' : 'mt-0.5'"
      >
        <div
          v-if="item.step.showAllIndicator"
          class="w-6 h-6 rounded-full flex items-center justify-center bg-gray-100 dark:bg-gray-800"
        >
          <UIcon
            name="i-lucide-layers"
            class="w-3 h-3 text-gray-600 dark:text-gray-400"
          />
        </div>
        <div
          v-else
          class="w-8 h-8 rounded-full flex items-center justify-center"
          :class="getStepStatusBg(item.step.status)"
        >
          <UIcon
            :name="getStepStatusIcon(item.step.status)"
            class="w-4 h-4"
            :class="getStepStatusIconColor(item.step.status)"
          />
        </div>
      </div>

      <!-- Step Details -->
      <div class="flex-1 min-w-0 ml-3">
        <h4 class="text-sm font-medium text-gray-900 dark:text-gray-100">
          {{ item.step.key }}
        </h4>
        <div
          v-if="!item.step.showAllIndicator"
          class="flex items-center gap-3 mt-1 text-xs text-gray-500"
        >
          <span
            class="capitalize"
            :class="getStepStatusTextColor(item.step.status)"
          >
            {{ item.step.status || 'pending' }}
          </span>
          <span v-if="item.step.attempt && item.step.attempt > 1">
            Attempt {{ item.step.attempt }}
          </span>
        </div>
        <div
          v-else
          class="mt-1 text-xs text-gray-500"
        >
          Show all events from all steps
        </div>

        <!-- Additional Details (from description slot) -->
        <div
          v-if="!item.step.showAllIndicator && (item.step.startedAt || item.step.completedAt || item.step.error || item.step.awaitType)"
          class="mt-3"
        >
          <!-- Timing Info -->
          <div
            v-if="item.step.startedAt || item.step.completedAt"
            class="flex items-center gap-4 text-xs text-gray-500"
          >
            <div
              v-if="item.step.startedAt"
              class="flex items-center gap-1"
            >
              <UIcon
                name="i-lucide-clock"
                class="w-3 h-3"
              />
              <span>{{ formatTime(item.step.startedAt) }}</span>
            </div>
            <div
              v-if="item.step.completedAt"
              class="flex items-center gap-1"
            >
              <UIcon
                name="i-lucide-check-circle"
                class="w-3 h-3"
              />
              <span>{{ formatTime(item.step.completedAt) }}</span>
            </div>
          </div>

          <!-- Error Message -->
          <div
            v-if="item.step.error"
            class="mt-2"
          >
            <div
              class="p-2 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded text-xs text-red-600 dark:text-red-400"
              :title="String(item.step.error || '')"
            >
              <div class="flex items-start gap-1">
                <UIcon
                  name="i-lucide-alert-circle"
                  class="w-3 h-3 flex-shrink-0 mt-0.5"
                />
                <p class="line-clamp-2 break-all">
                  {{ item.step.error }}
                </p>
              </div>
            </div>
          </div>

          <!-- Await Info -->
          <div
            v-if="item.step.awaitType"
            class="mt-2 p-2 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-900/30 rounded text-xs text-blue-600 dark:text-blue-400"
          >
            <div class="flex items-center gap-1">
              <UIcon
                name="i-lucide-timer"
                class="w-3 h-3"
              />
              <span>Waiting: {{ item.step.awaitType }}</span>
            </div>
          </div>
        </div>
      </div>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { tv } from 'tailwind-variants'
import { twMerge } from 'tailwind-merge'
import { UIcon } from '#components'
import type { ClassValue } from 'tailwind-variants'

const props = defineProps<{
  modelValue: string
  items: Array<{
    value: string
    label: string
    step: any
  }>
  ui?: {
    root?: ClassValue
    item?: ClassValue
    itemSelected?: ClassValue
    itemBase?: ClassValue
  }
}>()

defineEmits<{
  'update:modelValue': [value: string]
}>()

// Default UI configuration
const defaultUi = {
  root: 'space-y-3',
  itemBase: 'w-full flex items-start border rounded-lg text-sm p-3.5 transition-colors text-left hover:bg-gray-50 dark:hover:bg-gray-900/50',
  item: 'border-gray-200 dark:border-gray-800',
  itemSelected: 'border-primary bg-primary/5 dark:bg-primary/10',
}

// Merge user UI with default UI
const ui = computed(() => ({
  root: twMerge(defaultUi.root, props.ui?.root as string),
  itemBase: twMerge(defaultUi.itemBase, props.ui?.itemBase as string),
  item: props.ui?.item as string || defaultUi.item,
  itemSelected: props.ui?.itemSelected as string || defaultUi.itemSelected,
}))

// Create item variant using tailwind-variants
const itemVariants = computed(() => tv({
  base: ui.value.itemBase,
  variants: {
    selected: {
      true: ui.value.itemSelected,
      false: ui.value.item,
    },
  },
}))

// Compute classes for each item
const itemClasses = (item: any) => {
  return itemVariants.value({
    selected: props.modelValue === item.value,
  })
}

// Helper to format timestamps
const formatTime = (timestamp: string | number | Date) => {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0)
    return `${days}d ago`
  if (hours > 0)
    return `${hours}h ago`
  if (minutes > 0)
    return `${minutes}m ago`
  if (seconds > 10)
    return `${seconds}s ago`
  return 'just now'
}

// Step status helpers
const getStepStatusBg = (status?: string) => {
  switch (status) {
    case 'completed': return 'bg-emerald-50 dark:bg-emerald-900/20'
    case 'failed': return 'bg-red-50 dark:bg-red-900/20'
    case 'running': return 'bg-blue-50 dark:bg-blue-900/20'
    default: return 'bg-gray-50 dark:bg-gray-900/20'
  }
}

const getStepStatusIcon = (status?: string) => {
  switch (status) {
    case 'completed': return 'i-lucide-check-circle'
    case 'failed': return 'i-lucide-x-circle'
    case 'running': return 'i-lucide-loader-circle'
    default: return 'i-lucide-circle'
  }
}

const getStepStatusIconColor = (status?: string) => {
  switch (status) {
    case 'completed': return 'text-emerald-600 dark:text-emerald-400'
    case 'failed': return 'text-red-600 dark:text-red-400'
    case 'running': return 'text-blue-600 dark:text-blue-400 animate-spin'
    default: return 'text-gray-400'
  }
}

const getStepStatusTextColor = (status?: string) => {
  switch (status) {
    case 'completed': return 'text-emerald-600 dark:text-emerald-400'
    case 'failed': return 'text-red-600 dark:text-red-400'
    case 'running': return 'text-blue-600 dark:text-blue-400'
    default: return 'text-gray-500'
  }
}
</script>
