<template>
  <div class="h-full flex flex-col overflow-hidden">
    <!-- Header -->
    <div class="border-b border-gray-200 dark:border-gray-800 px-6 py-3 shrink-0">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-4">
          <UButton
            icon="i-lucide-arrow-left"
            size="xs"
            color="neutral"
            variant="ghost"
            @click="back"
          />
          <div>
            <h1 class="text-lg font-semibold">
              {{ queueName }}
            </h1>
            <p class="text-xs text-gray-500">
              Queue Jobs
            </p>
          </div>
        </div>
        <div class="flex items-center gap-3">
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
          <UButton
            icon="i-lucide-settings"
            size="xs"
            color="neutral"
            variant="ghost"
            square
            title="View configuration"
            @click="showConfig = !showConfig"
          />
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex-1 min-h-0 overflow-hidden">
      <div class="h-full flex gap-px bg-gray-200 dark:bg-gray-800">
        <!-- Left: Jobs List -->
        <div class="w-1/3 min-w-0 flex-shrink-0 bg-white dark:bg-gray-950 flex flex-col min-h-0 overflow-hidden">
          <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between shrink-0">
            <h2 class="text-sm font-medium text-gray-900 dark:text-gray-100">
              Jobs
            </h2>
            <div class="flex items-center gap-2">
              <USelectMenu
                v-model="selectedStateOption"
                :items="stateOptions"
                placeholder="All States"
                size="xs"
                class="w-32"
              />
            </div>
          </div>
          
          <div
            v-if="!data || !data.jobs || data.jobs.length === 0"
            class="flex-1 flex items-center justify-center"
          >
            <div class="text-center">
              <UIcon
                name="i-lucide-inbox"
                class="w-8 h-8 mx-auto mb-2 text-gray-300 dark:text-gray-700"
              />
              <p class="text-sm text-gray-500 dark:text-gray-400">
                No jobs found
              </p>
            </div>
          </div>

          <div
            v-else
            class="flex-1 min-h-0 overflow-y-auto"
          >
            <div class="divide-y divide-gray-100 dark:divide-gray-800">
              <div
                v-for="job in paginatedJobs"
                :key="job.id"
                class="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-900/50 cursor-pointer transition-colors"
                :class="{
                  'bg-blue-50 dark:bg-blue-950/30 border-l-2 border-l-blue-500': selectedJobId === job.id
                }"
                @click="selectJob(job.id)"
              >
                <div class="flex items-start gap-3">
                  <div class="flex-shrink-0 mt-0.5">
                    <UIcon
                      :name="getJobIcon(job.state)"
                      class="w-5 h-5"
                      :class="getJobIconColor(job.state)"
                    />
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between gap-2 mb-1">
                      <h3 class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {{ job.name }}
                      </h3>
                      <UBadge
                        :label="job.state || 'unknown'"
                        :color="getStateBadgeColor(job.state)"
                        variant="subtle"
                        size="xs"
                        class="capitalize flex-shrink-0"
                      />
                    </div>
                    <p class="text-xs text-gray-500 dark:text-gray-400 font-mono truncate mb-1">
                      {{ truncateId(job.id) }}
                    </p>
                    <div class="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                      <span v-if="job.timestamp">
                        {{ formatTime(job.timestamp) }}
                      </span>
                      <span v-if="job.finishedOn && job.processedOn">
                        • {{ formatDuration(job.processedOn, job.finishedOn) }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Pagination Footer -->
          <div
            v-if="data && data.total > jobsPerPage"
            class="border-t border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center justify-center shrink-0"
          >
            <UPagination
              v-model:page="currentPage"
              :items-per-page="jobsPerPage"
              :total="data.total"
              size="xs"
            />
          </div>
        </div>

        <!-- Right: Overview or Job Details -->
        <div class="flex-1 min-w-0 bg-white dark:bg-gray-950 flex flex-col min-h-0 overflow-hidden">
          <div class="px-4 py-2.5 border-b border-gray-200 dark:border-gray-800 shrink-0">
            <div class="flex items-center justify-between">
              <UTabs
                v-model="activeTab"
                :items="tabItems"
                size="xs"
                :ui="{
                  root: 'gap-0',
                  trigger: 'px-2 py-0.5',
                }"
              />
            </div>
          </div>

          <div class="flex-1 min-h-0 overflow-y-auto">
            <!-- Overview Tab -->
            <div
              v-if="activeTab === 'overview'"
              class="p-6 space-y-6"
            >
              <!-- Stats Cards -->
              <div>
                <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">
                  Queue Statistics
                </h3>
                <div class="grid grid-cols-2 gap-4">
                  <StatCard
                    icon="i-lucide-clock"
                    :count="counts?.waiting || 0"
                    label="Waiting"
                    variant="blue"
                  />
                  <StatCard
                    icon="i-lucide-loader-2"
                    :count="counts?.active || 0"
                    label="Active"
                    variant="amber"
                  />
                  <StatCard
                    icon="i-lucide-check-circle"
                    :count="counts?.completed || 0"
                    label="Completed"
                    variant="emerald"
                  />
                  <StatCard
                    icon="i-lucide-x-circle"
                    :count="counts?.failed || 0"
                    label="Failed"
                    variant="red"
                  />
                  <StatCard
                    icon="i-lucide-timer"
                    :count="counts?.delayed || 0"
                    label="Delayed"
                    variant="purple"
                  />
                  <StatCard
                    icon="i-lucide-pause-circle"
                    :count="counts?.paused || 0"
                    label="Paused"
                    variant="gray"
                  />
                </div>
              </div>

              <!-- Queue Configuration -->
              <div>
                <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">
                  Queue Configuration
                </h3>
                <div class="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4 space-y-3">
                  <div class="flex items-center justify-between py-2 border-b border-gray-200 dark:border-gray-800">
                    <span class="text-sm text-gray-600 dark:text-gray-400">Queue Name</span>
                    <span class="text-sm font-medium text-gray-900 dark:text-gray-100 font-mono">{{ queueName }}</span>
                  </div>
                  <div class="flex items-center justify-between py-2 border-b border-gray-200 dark:border-gray-800">
                    <span class="text-sm text-gray-600 dark:text-gray-400">Total Jobs</span>
                    <span class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ data?.jobs?.length || 0 }}</span>
                  </div>
                  <div class="flex items-center justify-between py-2">
                    <span class="text-sm text-gray-600 dark:text-gray-400">Connection Status</span>
                    <UBadge
                      :label="isConnected ? 'Connected' : isReconnecting ? 'Reconnecting' : 'Disconnected'"
                      :color="isConnected ? 'success' : isReconnecting ? 'warning' : 'error'"
                      variant="subtle"
                      size="xs"
                    />
                  </div>
                </div>
              </div>
            </div>

            <!-- Job Details Tab -->
            <div
              v-else-if="activeTab === 'details' && selectedJob"
              class="p-6 space-y-6"
            >
              <!-- Job Info -->
              <div>
                <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
                  <UIcon
                    :name="getJobIcon(selectedJob.state)"
                    class="w-5 h-5"
                    :class="getJobIconColor(selectedJob.state)"
                  />
                  <span>Job Information</span>
                </h3>
                <div class="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4 space-y-3">
                  <div class="flex items-center justify-between py-2 border-b border-gray-200 dark:border-gray-800">
                    <span class="text-sm text-gray-600 dark:text-gray-400">ID</span>
                    <span class="text-xs font-mono text-gray-900 dark:text-gray-100">{{ selectedJob.id }}</span>
                  </div>
                  <div class="flex items-center justify-between py-2 border-b border-gray-200 dark:border-gray-800">
                    <span class="text-sm text-gray-600 dark:text-gray-400">Name</span>
                    <span class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ selectedJob.name }}</span>
                  </div>
                  <div class="flex items-center justify-between py-2">
                    <span class="text-sm text-gray-600 dark:text-gray-400">State</span>
                    <UBadge
                      :label="selectedJob.state || 'unknown'"
                      :color="getStateBadgeColor(selectedJob.state)"
                      variant="subtle"
                      size="xs"
                      class="capitalize"
                    />
                  </div>
                </div>
              </div>

              <!-- Timing -->
              <div>
                <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">
                  Timing
                </h3>
                <div class="space-y-4">
                  <div class="grid grid-cols-1 gap-3">
                    <div class="flex items-center justify-between py-2 bg-gray-50 dark:bg-gray-900/50 rounded-lg px-4">
                      <span class="text-sm text-gray-600 dark:text-gray-400">Created</span>
                      <span class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ formatDate(selectedJob.timestamp) }}</span>
                    </div>
                    <div
                      v-if="selectedJob.processedOn"
                      class="flex items-center justify-between py-2 bg-gray-50 dark:bg-gray-900/50 rounded-lg px-4"
                    >
                      <span class="text-sm text-gray-600 dark:text-gray-400">Processed</span>
                      <span class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ formatDate(selectedJob.processedOn) }}</span>
                    </div>
                    <div
                      v-if="selectedJob.finishedOn"
                      class="flex items-center justify-between py-2 bg-gray-50 dark:bg-gray-900/50 rounded-lg px-4"
                    >
                      <span class="text-sm text-gray-600 dark:text-gray-400">Finished</span>
                      <span class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ formatDate(selectedJob.finishedOn) }}</span>
                    </div>
                  </div>

                  <!-- Duration Cards -->
                  <div
                    v-if="selectedJobWaitDuration || selectedJobExecutionDuration"
                    class="grid grid-cols-2 gap-3 pt-2"
                  >
                    <div
                      v-if="selectedJobWaitDuration"
                      class="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 text-center"
                    >
                      <p class="text-xs text-blue-600 dark:text-blue-400 mb-1">Wait Time</p>
                      <p class="text-lg font-bold text-blue-700 dark:text-blue-300">{{ selectedJobWaitDuration }}</p>
                    </div>
                    <div
                      v-if="selectedJobExecutionDuration"
                      class="rounded-lg p-4 text-center border"
                      :class="selectedJob.state === 'active' 
                        ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800' 
                        : 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800'"
                    >
                      <p class="text-xs mb-1" :class="selectedJob.state === 'active' ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'">
                        {{ selectedJob.state === 'active' ? 'Running' : 'Execution' }}
                      </p>
                      <p class="text-lg font-bold" :class="selectedJob.state === 'active' ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'">
                        {{ selectedJobExecutionDuration }}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Job Data -->
              <div>
                <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">
                  Job Data
                </h3>
                <div class="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 overflow-x-auto">
                  <pre class="text-xs font-mono">{{ JSON.stringify(selectedJob.data, null, 2) }}</pre>
                </div>
              </div>

              <!-- Return Value -->
              <div v-if="selectedJob.returnvalue">
                <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">
                  Return Value
                </h3>
                <div class="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg p-4 overflow-x-auto">
                  <pre class="text-xs font-mono text-emerald-900 dark:text-emerald-100">{{ JSON.stringify(selectedJob.returnvalue, null, 2) }}</pre>
                </div>
              </div>

              <!-- Error -->
              <div v-if="selectedJob.failedReason">
                <h3 class="text-sm font-semibold text-red-600 dark:text-red-400 mb-4">
                  Error
                </h3>
                <div class="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-4">
                  <p class="text-sm text-red-700 dark:text-red-300 whitespace-pre-wrap">{{ selectedJob.failedReason }}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Configuration Slideover -->
    <USlideover v-model:open="showConfig" title="Queue Configuration">
      <template #body>
        <QueueConfiguration
          :queue-name="queueName"
          :queue-config="queueInfo?.config?.queue"
          :worker-config="queueInfo?.config?.worker"
        />
      </template>
    </USlideover>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from '#imports'
import { UButton, UBadge, UPagination, USelectMenu, UIcon, UTabs, USlideover } from '#components'
import { useQueueJobs } from '../../composables/useQueueJobs'
import { useQueueUpdates } from '../../composables/useQueueUpdates'
import { useQueues } from '../../composables/useQueues'
import { useComponentRouter } from '../../composables/useComponentRouter'
import { useRoute, useRouter } from '#app'
import StatCard from '../../components/StatCard.vue'
import QueueConfiguration from '../../components/QueueConfiguration.vue'

const componentRouter = useComponentRouter()
const router = useRouter()
const route = useRoute()
const queueName = computed(() => componentRouter.route.value?.params?.name as string || '')

const stateOptions = [
  { label: 'All States', value: null },
  { label: 'Waiting', value: 'waiting' },
  { label: 'Active', value: 'active' },
  { label: 'Completed', value: 'completed' },
  { label: 'Failed', value: 'failed' },
  { label: 'Delayed', value: 'delayed' },
  { label: 'Paused', value: 'paused' },
]

// URL-based state for filter and pagination
const selectedState = computed({
  get: () => (route.query.state as string) || null,
  set: (value: string | null) => {
    router.push({
      query: {
        ...route.query,
        state: value || undefined,
        page: undefined, // Reset page when filter changes
      },
    })
  },
})

const currentPage = computed({
  get: () => {
    const page = route.query.page as string
    return page ? Number.parseInt(page, 10) : 1
  },
  set: (value: number) => {
    router.push({
      query: {
        ...route.query,
        page: value > 1 ? value.toString() : undefined,
      },
    })
  },
})

const selectedStateOption = computed({
  get: () => stateOptions.find(opt => opt.value === selectedState.value) || stateOptions[0],
  set: (option: typeof stateOptions[0]) => {
    selectedState.value = option.value
  },
})

const jobsPerPage = 20

// Build query options for server-side filtering and pagination
const jobQueryOptions = computed(() => ({
  state: selectedState.value,
  limit: jobsPerPage,
  offset: (currentPage.value - 1) * jobsPerPage,
}))

const { data, refresh } = useQueueJobs(queueName, jobQueryOptions)
const { counts: liveCounts, isConnected, isReconnecting, shouldRefreshJobs, resetRefreshFlag } = useQueueUpdates(queueName)

// Fetch queue data to get initial counts
const { queues } = useQueues()
const queueInfo = computed(() => {
  return queues.value?.find(q => q.name === queueName.value)
})

// Use live counts if available, otherwise use fetched counts from queue list
const counts = computed(() => liveCounts.value || queueInfo.value?.counts || null)

// Watch for shouldRefreshJobs flag and auto-refresh the job list
watch(shouldRefreshJobs, async (shouldRefresh) => {
  if (shouldRefresh) {
    await refresh()
    resetRefreshFlag()
  }
})

// Watch query options changes to refresh data
watch(() => jobQueryOptions.value, () => {
  refresh()
}, { deep: true })

// Jobs are already paginated by server, display directly
const paginatedJobs = computed(() => {
  return data.value?.jobs || []
})

// Selected job
const selectedJobId = ref<string | null>(null)
const selectedJob = computed(() => {
  if (!selectedJobId.value || !data.value?.jobs) return null
  return data.value.jobs.find(job => job.id === selectedJobId.value)
})

// Show configuration toggle
const showConfig = ref(false)

// Tabs
const activeTab = ref<'overview' | 'details'>('overview')
const tabItems = computed(() => [
  { label: 'Overview', value: 'overview', icon: 'i-lucide-bar-chart-3' },
  {
    label: 'Job Details',
    value: 'details',
    icon: 'i-lucide-file-text',
    disabled: !selectedJobId.value,
  },
])

// Watch for job selection - switch to details tab
watch(selectedJobId, (newId) => {
  if (newId) {
    activeTab.value = 'details'
    showConfig.value = false
  }
  else {
    activeTab.value = 'overview'
  }
})

// Watch for showConfig - clear job selection when opening config
watch(showConfig, (show) => {
  if (show) {
    selectedJobId.value = null
  }
})

const selectJob = (jobId: string) => {
  selectedJobId.value = jobId
}

const back = () => {
  componentRouter.push('/queues')
}

// Helper functions
const getJobIcon = (state?: string) => {
  switch (state) {
    case 'waiting': return 'i-lucide-clock'
    case 'active': return 'i-lucide-loader-2'
    case 'completed': return 'i-lucide-check-circle'
    case 'failed': return 'i-lucide-x-circle'
    case 'delayed': return 'i-lucide-timer'
    case 'paused': return 'i-lucide-pause-circle'
    default: return 'i-lucide-circle'
  }
}

const getJobIconColor = (state?: string) => {
  switch (state) {
    case 'waiting': return 'text-blue-500'
    case 'active': return 'text-amber-500 animate-spin'
    case 'completed': return 'text-emerald-500'
    case 'failed': return 'text-red-500'
    case 'delayed': return 'text-purple-500'
    case 'paused': return 'text-gray-500'
    default: return 'text-gray-400'
  }
}

const getStateBadgeColor = (state?: string): 'neutral' | 'info' | 'warning' | 'success' | 'error' | 'secondary' => {
  switch (state) {
    case 'waiting': return 'info'
    case 'active': return 'warning'
    case 'completed': return 'success'
    case 'failed': return 'error'
    case 'delayed': return 'secondary'
    case 'paused': return 'warning'
    default: return 'neutral'
  }
}

const truncateId = (id: string) => {
  if (id.length <= 16) return id
  return `${id.substring(0, 8)}...${id.substring(id.length - 8)}`
}

const formatTime = (timestamp: number | undefined) => {
  if (!timestamp) return '-'
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  if (seconds > 10) return `${seconds}s ago`
  return 'just now'
}

const formatDuration = (start: number, end: number) => {
  const diff = end - start
  if (diff < 1000) return `${diff}ms`
  if (diff < 60000) return `${(diff / 1000).toFixed(2)}s`
  if (diff < 3600000) return `${(diff / 60000).toFixed(2)}m`
  return `${(diff / 3600000).toFixed(2)}h`
}

const formatDate = (timestamp: number | undefined) => {
  if (!timestamp) return '-'
  return new Date(timestamp).toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

const selectedJobWaitDuration = computed(() => {
  if (!selectedJob.value?.timestamp || !selectedJob.value?.processedOn) return null
  return formatDuration(selectedJob.value.timestamp, selectedJob.value.processedOn)
})

const selectedJobExecutionDuration = computed(() => {
  if (!selectedJob.value?.processedOn) return null
  const endTime = selectedJob.value.finishedOn || Date.now()
  return formatDuration(selectedJob.value.processedOn, endTime)
})
</script>
