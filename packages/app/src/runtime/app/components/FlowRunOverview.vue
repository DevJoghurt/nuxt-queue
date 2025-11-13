<template>
  <div class="flex flex-col h-full">
    <!-- Fixed Header with Run Stats -->
    <div class="px-6 py-[17px] border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 shrink-0">
      <div class="flex items-center gap-4 text-xs">
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

      <div
        v-else
        class="space-y-3"
      >
        <div
          v-for="(step, idx) in steps"
          :key="step.key"
          class="relative"
        >
          <!-- Connecting Line -->
          <div
            v-if="idx < steps.length - 1"
            class="absolute left-4 top-10 w-0.5 h-8 bg-gray-200 dark:bg-gray-800"
          />

          <!-- Step Card -->
          <div class="bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg p-4 hover:border-gray-300 dark:hover:border-gray-700 transition-colors">
            <div class="flex items-start gap-3">
              <!-- Status Icon -->
              <div class="flex-shrink-0 mt-0.5">
                <div
                  class="w-8 h-8 rounded-full flex items-center justify-center"
                  :class="getStepStatusBg(step.status)"
                >
                  <UIcon
                    :name="getStepStatusIcon(step.status)"
                    class="w-4 h-4"
                    :class="getStepStatusIconColor(step.status)"
                  />
                </div>
              </div>

              <!-- Step Details -->
              <div class="flex-1 min-w-0">
                <div class="flex items-start justify-between gap-2">
                  <div class="flex-1">
                    <h4 class="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {{ step.key }}
                    </h4>
                    <div class="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      <span
                        class="capitalize"
                        :class="getStepStatusTextColor(step.status)"
                      >
                        {{ step.status || 'pending' }}
                      </span>
                      <span v-if="step.attempt && step.attempt > 1">
                        Attempt {{ step.attempt }}
                      </span>
                    </div>
                  </div>
                </div>

                <!-- Timing Info -->
                <div
                  v-if="step.startedAt || step.completedAt"
                  class="mt-2 flex items-center gap-4 text-xs text-gray-500"
                >
                  <div
                    v-if="step.startedAt"
                    class="flex items-center gap-1"
                  >
                    <UIcon
                      name="i-lucide-clock"
                      class="w-3 h-3"
                    />
                    <span>{{ formatTime(step.startedAt) }}</span>
                  </div>
                  <div
                    v-if="step.completedAt"
                    class="flex items-center gap-1"
                  >
                    <UIcon
                      name="i-lucide-check-circle"
                      class="w-3 h-3"
                    />
                    <span>{{ formatTime(step.completedAt) }}</span>
                  </div>
                </div>

                <!-- Error Message -->
                <div
                  v-if="step.error"
                  class="mt-2 p-2 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded text-xs text-red-600 dark:text-red-400"
                >
                  <div class="flex items-start gap-1">
                    <UIcon
                      name="i-lucide-alert-circle"
                      class="w-3 h-3 flex-shrink-0 mt-0.5"
                    />
                    <span>{{ step.error }}</span>
                  </div>
                </div>

                <!-- Await Info -->
                <div
                  v-if="step.awaitType"
                  class="mt-2 p-2 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-900/30 rounded text-xs text-blue-600 dark:text-blue-400"
                >
                  <div class="flex items-center gap-1">
                    <UIcon
                      name="i-lucide-timer"
                      class="w-3 h-3"
                    />
                    <span>Waiting: {{ step.awaitType }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { UIcon } from '#components'

defineProps<{
  runStatus?: string
  startedAt?: string
  completedAt?: string
  steps: any[]
}>()

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
const getDuration = (start?: string, end?: string) => {
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
    default: return 'bg-gray-300'
  }
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
