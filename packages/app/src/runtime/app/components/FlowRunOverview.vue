<template>
  <div class="flex flex-col h-full w-full max-w-full min-w-0">
    <!-- Fixed Header with Run Stats -->
    <div class="px-6 py-[17px] border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 shrink-0">
      <div class="flex items-center justify-between gap-4 text-xs">
        <div class="flex items-center gap-4">
          <!-- Status -->
          <div class="flex items-center gap-1.5">
            <div
              class="w-1.5 h-1.5 rounded-full"
              :class="getStatusColor(runStatus)"
            />
            <span class="text-gray-700 dark:text-gray-300 font-medium capitalize">
              {{ runStatus || 'unknown' }}
            </span>
          </div>

          <!-- Divider -->
          <div class="w-px h-3 bg-gray-300 dark:bg-gray-700" />

          <!-- Total Steps -->
          <div class="flex items-center gap-1.5">
            <UIcon
              name="i-lucide-layers"
              class="w-3 h-3 text-gray-500"
            />
            <span class="text-gray-700 dark:text-gray-300">
              {{ steps.length }} {{ steps.length === 1 ? 'step' : 'steps' }}
            </span>
          </div>

          <!-- Divider -->
          <div class="w-px h-3 bg-gray-300 dark:bg-gray-700" />

          <!-- Started -->
          <div class="flex items-center gap-1.5">
            <UIcon
              name="i-lucide-clock"
              class="w-3 h-3 text-gray-500"
            />
            <span class="text-gray-600 dark:text-gray-400">
              {{ startedAt ? formatTime(startedAt) : 'Not started' }}
            </span>
          </div>

          <!-- Divider -->
          <div class="w-px h-3 bg-gray-300 dark:bg-gray-700" />

          <!-- Duration -->
          <div class="flex items-center gap-1.5">
            <UIcon
              name="i-lucide-timer"
              class="w-3 h-3 text-gray-500"
            />
            <span class="text-gray-600 dark:text-gray-400">
              {{ getDuration(startedAt, completedAt) }}
            </span>
          </div>
        </div>

        <!-- Cancel Button (only show for running flows) -->
        <UButton
          v-if="runStatus === 'running'"
          color="neutral"
          variant="ghost"
          icon="i-lucide-x-circle"
          size="xs"
          label="Cancel"
          @click="handleCancelFlow"
        />
      </div>
    </div>

    <!-- Scrollable Steps List -->
    <div class="flex-1 overflow-y-auto overflow-x-hidden px-6 py-6">
      <div
        v-if="steps.length === 0"
        class="h-full flex flex-col items-center justify-center text-gray-400 dark:text-gray-500"
      >
        <UIcon
          name="i-lucide-layers"
          class="w-12 h-12 mb-3 opacity-50"
        />
        <span class="text-sm">No steps executed yet</span>
      </div>

      <FlowStepSelector
        v-else
        v-model="selectedStep"
        :items="radioItems"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from '#imports'
import { UIcon, UButton } from '#components'
import FlowStepSelector from './FlowStepSelector.vue'

const props = defineProps<{
  runStatus?: string
  startedAt?: string | number
  completedAt?: string | number
  steps: any[]
  flowName?: string
  runId?: string
}>()

const emit = defineEmits<{
  'select-step': [stepKey: string | null]
  'cancel-flow': []
}>()

// Handle cancel flow action
const handleCancelFlow = () => {
  emit('cancel-flow')
}

// Selected step ('all-steps' = all steps, null would break URadioGroup)
const selectedStep = ref<string>('all-steps')

// Track the first step key to detect run changes
const firstStepKey = computed(() => props.steps[0]?.key)

// Reset selection only when run changes (first step key changes), not when new events arrive
watch(firstStepKey, (newKey, oldKey) => {
  // Only reset if first step actually changed (indicating a new run)
  if (oldKey !== undefined && newKey !== oldKey) {
    selectedStep.value = 'all-steps'
  }
})

// Watch selection and emit to parent
watch(selectedStep, (newStep: string) => {
  // Convert 'all-steps' to null for parent
  emit('select-step', newStep === 'all-steps' ? null : newStep)
})

// Transform steps into radio items with "All Steps" option
const radioItems = computed(() => {
  const allItem = {
    value: 'all-steps',
    label: 'All Steps',
    step: {
      key: 'All Steps',
      status: null,
      showAllIndicator: true,
    },
  }

  const stepItems = props.steps.map(step => ({
    value: step.key,
    label: step.key,
    step,
  }))

  return [allItem, ...stepItems]
})

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

// Helper to calculate duration
const getDuration = (start?: string | number, end?: string | number) => {
  if (!start)
    return '—'
  const startTime = new Date(start).getTime()
  const endTime = end ? new Date(end).getTime() : Date.now()
  const diff = endTime - startTime
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0)
    return `${hours}h ${minutes % 60}m`
  if (minutes > 0)
    return `${minutes}m ${seconds % 60}s`
  return `${seconds}s`
}

// Status color helpers
const getStatusColor = (status?: string) => {
  switch (status) {
    case 'completed': return 'bg-emerald-500'
    case 'failed': return 'bg-red-500'
    case 'running': return 'bg-blue-500 animate-pulse'
    case 'canceled': return 'bg-orange-500'
    case 'stalled': return 'bg-amber-600'
    default: return 'bg-gray-300'
  }
}
</script>
