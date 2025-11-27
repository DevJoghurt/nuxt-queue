<template>
  <div class="h-full flex flex-col overflow-hidden">
    <!-- Header -->
    <div class="border-b border-gray-200 dark:border-gray-800 px-6 py-3 shrink-0">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-4">
          <h1 class="text-lg font-semibold">
            Scheduler
          </h1>
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex-1 min-h-0 overflow-y-auto">
      <div class="max-w-7xl mx-auto p-6">
        <!-- Stats Overview -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <StatCard
            icon="i-lucide-briefcase"
            :count="stats.total"
            label="Total Jobs"
            variant="blue"
          />
          <StatCard
            icon="i-lucide-play-circle"
            :count="stats.active"
            label="Active Jobs"
            variant="emerald"
          />
          <StatCard
            icon="i-lucide-timer"
            :count="lastRunText"
            label="Last Run"
            variant="purple"
          />
        </div>

        <!-- Jobs List -->
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <UIcon name="i-lucide-list" class="text-gray-500" />
                <h3 class="text-lg font-semibold">
                  Scheduled Jobs
                </h3>
              </div>
              <UButton
                icon="i-lucide-refresh-cw"
                size="sm"
                color="gray"
                variant="ghost"
                :loading="loading"
                @click="loadJobs"
              >
                Refresh
              </UButton>
            </div>
          </template>

          <div v-if="loading && jobs.length === 0" class="text-center py-8">
            <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-gray-400 mx-auto mb-2" />
            <p class="text-gray-600 dark:text-gray-400">
              Loading jobs...
            </p>
          </div>

          <div v-else-if="jobs.length === 0" class="text-center py-8">
            <UIcon name="i-lucide-inbox" class="w-12 h-12 text-gray-400 mx-auto mb-2" />
            <p class="text-gray-600 dark:text-gray-400">
              No scheduled jobs found
            </p>
          </div>

          <div v-else class="space-y-2">
            <div
              v-for="job in jobs"
              :key="job.id"
              class="p-4 rounded-lg border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <div class="flex items-start justify-between">
                <div class="flex-1">
                  <div class="flex items-center gap-3 mb-2">
                    <UBadge
                      :color="getJobTypeColor(job.type)"
                      variant="subtle"
                      size="xs"
                    >
                      {{ job.type }}
                    </UBadge>
                    <UBadge
                      v-if="isJobActive(job)"
                      color="emerald"
                      variant="subtle"
                      size="xs"
                    >
                      <div class="flex items-center gap-1">
                        <div class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        <span>Active</span>
                      </div>
                    </UBadge>
                    <UBadge
                      v-else-if="job.enabled === false"
                      color="gray"
                      variant="subtle"
                      size="xs"
                    >
                      Disabled
                    </UBadge>
                    <h4 class="font-semibold text-gray-900 dark:text-white">
                      {{ job.name || job.id }}
                    </h4>
                  </div>

                  <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span class="text-gray-500 dark:text-gray-400">ID:</span>
                      <span class="ml-1 font-mono text-xs text-gray-700 dark:text-gray-300">
                        {{ job.id }}
                      </span>
                    </div>

                    <div v-if="job.interval">
                      <span class="text-gray-500 dark:text-gray-400">Interval:</span>
                      <span class="ml-1 font-medium text-gray-700 dark:text-gray-300">
                        {{ formatInterval(job.interval) }}
                      </span>
                    </div>

                    <div v-if="job.cron">
                      <span class="text-gray-500 dark:text-gray-400">Cron:</span>
                      <span class="ml-1 font-mono text-xs text-gray-700 dark:text-gray-300">
                        {{ job.cron }}
                      </span>
                    </div>

                    <div v-if="job.executeAt">
                      <span class="text-gray-500 dark:text-gray-400">Execute At:</span>
                      <span class="ml-1 text-gray-700 dark:text-gray-300">
                        {{ formatDate(job.executeAt) }}
                      </span>
                    </div>

                    <div v-if="job.lastRun">
                      <span class="text-gray-500 dark:text-gray-400">Last Run:</span>
                      <span class="ml-1 text-gray-700 dark:text-gray-300" :title="formatDate(job.lastRun)">
                        {{ formatRelativeTime(job.lastRun) }}
                      </span>
                    </div>

                    <div v-if="job.nextRun">
                      <span class="text-gray-500 dark:text-gray-400">Next Run:</span>
                      <span
                        class="ml-1 text-gray-700 dark:text-gray-300"
                        :class="{ 'text-emerald-600 dark:text-emerald-400 font-medium': isJobDueSoon(job) }"
                        :title="formatDate(job.nextRun)"
                      >
                        {{ formatRelativeTime(job.nextRun, true) }}
                      </span>
                    </div>

                    <div v-if="job.runCount !== undefined">
                      <span class="text-gray-500 dark:text-gray-400">Executions:</span>
                      <span class="ml-1 text-gray-700 dark:text-gray-300">
                        {{ job.runCount }}
                      </span>
                    </div>

                    <div v-if="job.failCount">
                      <span class="text-gray-500 dark:text-gray-400">Failures:</span>
                      <span class="ml-1 text-red-600 dark:text-red-400 font-medium">
                        {{ job.failCount }}
                      </span>
                    </div>
                  </div>

                  <div v-if="job.metadata" class="mt-3 pt-3 border-t border-gray-200 dark:border-gray-800">
                    <details class="text-xs">
                      <summary class="cursor-pointer text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
                        Metadata
                      </summary>
                      <pre class="mt-2 p-2 bg-gray-100 dark:bg-gray-900 rounded text-xs overflow-auto">{{ JSON.stringify(job.metadata, null, 2) }}</pre>
                    </details>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </UCard>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from '#imports'
import StatCard from '../../components/StatCard.vue'

interface SchedulerJob {
  id: string
  name?: string
  type: 'one-time' | 'interval' | 'cron'
  interval?: number
  cron?: string
  executeAt?: number
  lastRun?: number
  nextRun?: number
  runCount?: number
  failCount?: number
  enabled?: boolean
  metadata?: Record<string, any>
}

interface SchedulerStats {
  total: number
  active: number
  lastRun?: number
}

const jobs = ref<SchedulerJob[]>([])
const stats = ref<SchedulerStats>({
  total: 0,
  active: 0,
})
const loading = ref(false)

const lastRunText = computed(() => {
  if (!stats.value.lastRun) return 'Never'
  return formatRelativeTime(stats.value.lastRun)
})

async function loadJobs() {
  loading.value = true
  try {
    const response = await $fetch<{ jobs: SchedulerJob[], stats: SchedulerStats }>('/api/_scheduler/jobs')
    jobs.value = response.jobs || []
    stats.value = response.stats || { total: 0, active: 0 }
  }
  catch (error) {
    console.error('Failed to load scheduler jobs:', error)
  }
  finally {
    loading.value = false
  }
}

function getJobTypeColor(type: string) {
  switch (type) {
    case 'interval':
      return 'blue'
    case 'cron':
      return 'purple'
    case 'one-time':
      return 'green'
    default:
      return 'gray'
  }
}

function formatInterval(ms: number) {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d`
  if (hours > 0) return `${hours}h`
  if (minutes > 0) return `${minutes}m`
  return `${seconds}s`
}

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleString()
}

function formatRelativeTime(timestamp: number, future = false) {
  const now = Date.now()
  const diff = future ? timestamp - now : now - timestamp
  const seconds = Math.floor(Math.abs(diff) / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (future) {
    if (diff < 0) return 'Overdue'
    if (seconds < 60) return 'Now'
    if (minutes < 60) return `in ${minutes}m`
    if (hours < 24) return `in ${hours}h`
    return `in ${days}d`
  }

  if (seconds < 60) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

function isJobActive(job: SchedulerJob) {
  if (job.enabled === false) return false
  if (job.type === 'one-time') {
    return job.executeAt ? job.executeAt > Date.now() : false
  }
  return true // interval and cron jobs are active if enabled
}

function isJobDueSoon(job: SchedulerJob) {
  if (!job.nextRun) return false
  const diff = job.nextRun - Date.now()
  return diff > 0 && diff < 5 * 60 * 1000 // Due within 5 minutes
}

// Load jobs on mount
onMounted(() => {
  loadJobs()
})

// Auto-refresh every 30 seconds
const refreshInterval = setInterval(() => {
  loadJobs()
}, 30000)

onUnmounted(() => {
  clearInterval(refreshInterval)
})
</script>
