<template>
  <div class="py-6 space-y-3">
    <div
      v-if="logs.length === 0"
      class="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-12 text-center"
    >
      <UIcon
        name="i-lucide-file-text"
        class="w-8 h-8 mx-auto text-gray-300 mb-2"
      />
      <p class="text-sm text-gray-400">
        No logs yet
      </p>
    </div>

    <div
      v-else
      class="space-y-2"
    >
      <div
        v-for="(log, idx) in logs"
        :key="`log-${idx}`"
        class="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden"
      >
        <!-- Log Header (clickable) -->
        <button
          class="w-full text-left p-3 hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors flex items-center gap-3"
          @click="toggleLog(idx)"
        >
          <UIcon
            :name="getLogIcon(log.level)"
            :class="getLogIconColor(log.level)"
            class="w-4 h-4 flex-shrink-0"
          />

          <div class="flex-1 min-w-0">
            <div
              class="text-sm"
              :class="expandedLogs.has(idx) ? '' : 'truncate'"
            >
              <span
                class="font-medium"
                :class="getLogTextColor(log.level)"
              >{{ log.msg || log.message }}</span>
            </div>
            <div class="text-xs text-gray-500 mt-0.5">
              {{ formatTime(log.ts) }}
              <span
                v-if="log.step || log.stepName"
                class="ml-2"
              >
                • {{ log.step || log.stepName }}
              </span>
            </div>
          </div>

          <UIcon
            :name="expandedLogs.has(idx) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
            class="w-4 h-4 text-gray-400 flex-shrink-0"
          />
        </button>

        <!-- Log Details (expandable) -->
        <div
          v-if="expandedLogs.has(idx)"
          class="p-4 bg-gray-50 dark:bg-gray-900/30 border-t border-gray-200 dark:border-gray-800"
        >
          <div class="space-y-3 text-xs">
            <div
              v-if="log.data"
              class="font-mono bg-white dark:bg-gray-950 p-3 rounded border border-gray-200 dark:border-gray-800 overflow-x-auto"
            >
              <pre class="text-xs">{{ JSON.stringify(log.data, null, 2) }}</pre>
            </div>
            <div class="flex gap-4 text-gray-500">
              <div>
                <span class="font-medium">Level:</span>
                <span
                  class="ml-1 capitalize"
                  :class="getLogTextColor(log.level)"
                >{{ log.level }}</span>
              </div>
              <div v-if="log.stepName">
                <span class="font-medium">Step:</span>
                <span class="ml-1 font-mono">{{ log.stepName }}</span>
              </div>
              <div>
                <span class="font-medium">Time:</span>
                <span class="ml-1">{{ new Date(log.ts).toLocaleString() }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from '#imports'

defineProps<{
  logs: any[]
}>()

const expandedLogs = ref(new Set<number>())

const toggleLog = (idx: number) => {
  if (expandedLogs.value.has(idx)) {
    expandedLogs.value.delete(idx)
  }
  else {
    expandedLogs.value.add(idx)
  }
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

// Log helpers
const getLogIcon = (level?: string) => {
  switch (level) {
    case 'error': return 'i-lucide-alert-circle'
    case 'warn': return 'i-lucide-alert-triangle'
    case 'info': return 'i-lucide-info'
    case 'debug': return 'i-lucide-bug'
    default: return 'i-lucide-message-square'
  }
}

const getLogIconColor = (level?: string) => {
  switch (level) {
    case 'error': return 'text-red-500'
    case 'warn': return 'text-amber-500'
    case 'info': return 'text-blue-500'
    case 'debug': return 'text-purple-500'
    default: return 'text-gray-400'
  }
}

const getLogTextColor = (level?: string) => {
  switch (level) {
    case 'error': return 'text-red-600 dark:text-red-400'
    case 'warn': return 'text-amber-600 dark:text-amber-400'
    case 'info': return 'text-blue-600 dark:text-blue-400'
    case 'debug': return 'text-purple-600 dark:text-purple-400'
    default: return 'text-gray-600'
  }
}
</script>
