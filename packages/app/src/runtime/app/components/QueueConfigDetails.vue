<template>
  <USlideover
    v-model:open="isOpen"
    :ui="{
      body: 'p-0 sm:p-0',
    }"
  >
    <template #title>
      <div class="flex items-center justify-between w-full pr-4">
        <div>
          <div class="text-sm font-semibold">
            Queue Configuration
          </div>
          <div class="text-xs font-mono text-gray-500 mt-0.5">
            {{ queueName }}
          </div>
        </div>
      </div>
    </template>
    <template #body>
      <!-- Fixed Tabs Header -->
      <div class="sticky top-0 z-10 bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 px-6 pt-2">
        <UTabs
          v-model="selectedTab"
          :items="tabs"
        />
      </div>

      <!-- Scrollable Content Area -->
      <div class="flex-1 overflow-y-auto overflow-x-hidden">
        <!-- Queue Config Tab -->
        <div
          v-if="selectedTab === 'queue'"
          class="p-6 space-y-6"
        >
          <div
            v-if="!queueConfig || !hasQueueConfig"
            class="text-sm text-gray-400 text-center py-8"
          >
            <UIcon
              name="i-lucide-info"
              class="w-8 h-8 mx-auto mb-2 opacity-50"
            />
            <p>No queue configuration defined</p>
            <p class="text-xs mt-1">
              Using default values
            </p>
          </div>
          <template v-else>
            <!-- Queue Name -->
            <div class="space-y-2">
              <div class="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <UIcon
                  name="i-lucide-tag"
                  class="w-4 h-4"
                />
                <span>Queue Name</span>
              </div>
              <div class="pl-6">
                <div class="text-sm font-mono text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-gray-900 px-3 py-2 rounded border border-gray-200 dark:border-gray-800">
                  {{ queueConfig.name || queueName }}
                </div>
              </div>
            </div>

            <!-- Prefix -->
            <div
              v-if="queueConfig.prefix"
              class="space-y-2"
            >
              <div class="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <UIcon
                  name="i-lucide-folder"
                  class="w-4 h-4"
                />
                <span>Prefix</span>
              </div>
              <div class="pl-6">
                <div class="text-sm font-mono text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-gray-900 px-3 py-2 rounded border border-gray-200 dark:border-gray-800">
                  {{ queueConfig.prefix }}
                </div>
                <p class="text-xs text-gray-500 mt-1">
                  Redis key prefix for this queue
                </p>
              </div>
            </div>

            <!-- Rate Limiter -->
            <div
              v-if="queueConfig.limiter"
              class="space-y-2"
            >
              <div class="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <UIcon
                  name="i-lucide-gauge"
                  class="w-4 h-4"
                />
                <span>Rate Limiter</span>
              </div>
              <div class="pl-6 space-y-3">
                <div class="bg-gray-50 dark:bg-gray-900 px-3 py-2 rounded border border-gray-200 dark:border-gray-800">
                  <div class="flex items-center justify-between text-sm">
                    <span class="text-gray-600 dark:text-gray-400">Max Jobs</span>
                    <span class="font-medium text-gray-900 dark:text-gray-100">{{ queueConfig.limiter.max }}</span>
                  </div>
                </div>
                <div class="bg-gray-50 dark:bg-gray-900 px-3 py-2 rounded border border-gray-200 dark:border-gray-800">
                  <div class="flex items-center justify-between text-sm">
                    <span class="text-gray-600 dark:text-gray-400">Duration</span>
                    <span class="font-medium text-gray-900 dark:text-gray-100">{{ queueConfig.limiter.duration }}ms</span>
                  </div>
                </div>
                <div
                  v-if="queueConfig.limiter.groupKey"
                  class="bg-gray-50 dark:bg-gray-900 px-3 py-2 rounded border border-gray-200 dark:border-gray-800"
                >
                  <div class="flex items-center justify-between text-sm">
                    <span class="text-gray-600 dark:text-gray-400">Group Key</span>
                    <span class="font-medium font-mono text-gray-900 dark:text-gray-100">{{ queueConfig.limiter.groupKey }}</span>
                  </div>
                </div>
                <p class="text-xs text-gray-500">
                  Limits processing to {{ queueConfig.limiter.max }} jobs per {{ queueConfig.limiter.duration }}ms
                </p>
              </div>
            </div>

            <!-- Default Job Options -->
            <div
              v-if="queueConfig.defaultJobOptions && hasJobOptions"
              class="space-y-2"
            >
              <div class="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <UIcon
                  name="i-lucide-settings"
                  class="w-4 h-4"
                />
                <span>Default Job Options</span>
              </div>
              <div class="pl-6 space-y-3">
                <div
                  v-if="typeof queueConfig.defaultJobOptions.attempts === 'number'"
                  class="bg-gray-50 dark:bg-gray-900 px-3 py-2 rounded border border-gray-200 dark:border-gray-800"
                >
                  <div class="flex items-center justify-between text-sm">
                    <span class="text-gray-600 dark:text-gray-400">Max Attempts</span>
                    <span class="font-medium text-gray-900 dark:text-gray-100">{{ queueConfig.defaultJobOptions.attempts }}</span>
                  </div>
                </div>
                <div
                  v-if="queueConfig.defaultJobOptions.backoff"
                  class="bg-gray-50 dark:bg-gray-900 px-3 py-2 rounded border border-gray-200 dark:border-gray-800"
                >
                  <div class="text-sm space-y-1">
                    <div class="flex items-center justify-between">
                      <span class="text-gray-600 dark:text-gray-400">Backoff Type</span>
                      <span class="font-medium text-gray-900 dark:text-gray-100">{{ queueConfig.defaultJobOptions.backoff.type || 'exponential' }}</span>
                    </div>
                    <div
                      v-if="queueConfig.defaultJobOptions.backoff.delay"
                      class="flex items-center justify-between"
                    >
                      <span class="text-gray-600 dark:text-gray-400">Delay</span>
                      <span class="font-medium text-gray-900 dark:text-gray-100">{{ queueConfig.defaultJobOptions.backoff.delay }}ms</span>
                    </div>
                  </div>
                </div>
                <div
                  v-if="typeof queueConfig.defaultJobOptions.priority === 'number'"
                  class="bg-gray-50 dark:bg-gray-900 px-3 py-2 rounded border border-gray-200 dark:border-gray-800"
                >
                  <div class="flex items-center justify-between text-sm">
                    <span class="text-gray-600 dark:text-gray-400">Priority</span>
                    <span class="font-medium text-gray-900 dark:text-gray-100">{{ queueConfig.defaultJobOptions.priority }}</span>
                  </div>
                </div>
                <div
                  v-if="typeof queueConfig.defaultJobOptions.timeout === 'number'"
                  class="bg-gray-50 dark:bg-gray-900 px-3 py-2 rounded border border-gray-200 dark:border-gray-800"
                >
                  <div class="flex items-center justify-between text-sm">
                    <span class="text-gray-600 dark:text-gray-400">Timeout</span>
                    <span class="font-medium text-gray-900 dark:text-gray-100">{{ queueConfig.defaultJobOptions.timeout }}ms</span>
                  </div>
                </div>
                <div
                  v-if="typeof queueConfig.defaultJobOptions.removeOnComplete === 'boolean' || typeof queueConfig.defaultJobOptions.removeOnComplete === 'number'"
                  class="bg-gray-50 dark:bg-gray-900 px-3 py-2 rounded border border-gray-200 dark:border-gray-800"
                >
                  <div class="flex items-center justify-between text-sm">
                    <span class="text-gray-600 dark:text-gray-400">Remove on Complete</span>
                    <span class="font-medium text-gray-900 dark:text-gray-100">{{ queueConfig.defaultJobOptions.removeOnComplete }}</span>
                  </div>
                </div>
                <div
                  v-if="typeof queueConfig.defaultJobOptions.removeOnFail === 'boolean' || typeof queueConfig.defaultJobOptions.removeOnFail === 'number'"
                  class="bg-gray-50 dark:bg-gray-900 px-3 py-2 rounded border border-gray-200 dark:border-gray-800"
                >
                  <div class="flex items-center justify-between text-sm">
                    <span class="text-gray-600 dark:text-gray-400">Remove on Fail</span>
                    <span class="font-medium text-gray-900 dark:text-gray-100">{{ queueConfig.defaultJobOptions.removeOnFail }}</span>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>

        <!-- Worker Config Tab -->
        <div
          v-if="selectedTab === 'worker'"
          class="p-6 space-y-6"
        >
          <div
            v-if="!workerConfig || !hasWorkerConfig"
            class="text-sm text-gray-400 text-center py-8"
          >
            <UIcon
              name="i-lucide-info"
              class="w-8 h-8 mx-auto mb-2 opacity-50"
            />
            <p>No worker configuration defined</p>
            <p class="text-xs mt-1">
              Using default values
            </p>
          </div>
          <template v-else>
            <!-- Concurrency -->
            <div
              v-if="typeof workerConfig.concurrency === 'number'"
              class="space-y-2"
            >
              <div class="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <UIcon
                  name="i-lucide-layers"
                  class="w-4 h-4"
                />
                <span>Concurrency</span>
              </div>
              <div class="pl-6">
                <div class="text-sm bg-gray-50 dark:bg-gray-900 px-3 py-2 rounded border border-gray-200 dark:border-gray-800">
                  <div class="flex items-center justify-between">
                    <span class="text-gray-600 dark:text-gray-400">Parallel Jobs</span>
                    <span class="font-medium text-gray-900 dark:text-gray-100">{{ workerConfig.concurrency }}</span>
                  </div>
                </div>
                <p class="text-xs text-gray-500 mt-1">
                  Maximum number of jobs processed simultaneously
                </p>
              </div>
            </div>

            <!-- Lock Duration -->
            <div
              v-if="typeof workerConfig.lockDurationMs === 'number'"
              class="space-y-2"
            >
              <div class="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <UIcon
                  name="i-lucide-lock"
                  class="w-4 h-4"
                />
                <span>Lock Duration</span>
              </div>
              <div class="pl-6">
                <div class="text-sm bg-gray-50 dark:bg-gray-900 px-3 py-2 rounded border border-gray-200 dark:border-gray-800">
                  <div class="flex items-center justify-between">
                    <span class="text-gray-600 dark:text-gray-400">Duration</span>
                    <span class="font-medium text-gray-900 dark:text-gray-100">{{ workerConfig.lockDurationMs }}ms</span>
                  </div>
                </div>
                <p class="text-xs text-gray-500 mt-1">
                  Time before job lock expires and becomes available for retry
                </p>
              </div>
            </div>

            <!-- Max Stalled Count -->
            <div
              v-if="typeof workerConfig.maxStalledCount === 'number'"
              class="space-y-2"
            >
              <div class="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <UIcon
                  name="i-lucide-alert-triangle"
                  class="w-4 h-4"
                />
                <span>Max Stalled Count</span>
              </div>
              <div class="pl-6">
                <div class="text-sm bg-gray-50 dark:bg-gray-900 px-3 py-2 rounded border border-gray-200 dark:border-gray-800">
                  <div class="flex items-center justify-between">
                    <span class="text-gray-600 dark:text-gray-400">Max Retries</span>
                    <span class="font-medium text-gray-900 dark:text-gray-100">{{ workerConfig.maxStalledCount }}</span>
                  </div>
                </div>
                <p class="text-xs text-gray-500 mt-1">
                  Maximum times a job can stall before being marked as failed
                </p>
              </div>
            </div>

            <!-- Drain Delay -->
            <div
              v-if="typeof workerConfig.drainDelayMs === 'number'"
              class="space-y-2"
            >
              <div class="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <UIcon
                  name="i-lucide-timer"
                  class="w-4 h-4"
                />
                <span>Drain Delay</span>
              </div>
              <div class="pl-6">
                <div class="text-sm bg-gray-50 dark:bg-gray-900 px-3 py-2 rounded border border-gray-200 dark:border-gray-800">
                  <div class="flex items-center justify-between">
                    <span class="text-gray-600 dark:text-gray-400">Delay</span>
                    <span class="font-medium text-gray-900 dark:text-gray-100">{{ workerConfig.drainDelayMs }}ms</span>
                  </div>
                </div>
                <p class="text-xs text-gray-500 mt-1">
                  Time to wait for jobs to complete during graceful shutdown
                </p>
              </div>
            </div>

            <!-- Polling Interval -->
            <div
              v-if="typeof workerConfig.pollingIntervalMs === 'number'"
              class="space-y-2"
            >
              <div class="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <UIcon
                  name="i-lucide-refresh-cw"
                  class="w-4 h-4"
                />
                <span>Polling Interval</span>
              </div>
              <div class="pl-6">
                <div class="text-sm bg-gray-50 dark:bg-gray-900 px-3 py-2 rounded border border-gray-200 dark:border-gray-800">
                  <div class="flex items-center justify-between">
                    <span class="text-gray-600 dark:text-gray-400">Interval</span>
                    <span class="font-medium text-gray-900 dark:text-gray-100">{{ workerConfig.pollingIntervalMs }}ms</span>
                  </div>
                </div>
                <p class="text-xs text-gray-500 mt-1">
                  Frequency to check for new jobs (PGBoss compatibility)
                </p>
              </div>
            </div>

            <!-- Autorun -->
            <div
              v-if="typeof workerConfig.autorun === 'boolean'"
              class="space-y-2"
            >
              <div class="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <UIcon
                  name="i-lucide-play-circle"
                  class="w-4 h-4"
                />
                <span>Autorun</span>
              </div>
              <div class="pl-6">
                <div class="text-sm bg-gray-50 dark:bg-gray-900 px-3 py-2 rounded border border-gray-200 dark:border-gray-800">
                  <div class="flex items-center justify-between">
                    <span class="text-gray-600 dark:text-gray-400">Enabled</span>
                    <span class="font-medium text-gray-900 dark:text-gray-100">{{ workerConfig.autorun ? 'Yes' : 'No' }}</span>
                  </div>
                </div>
                <p class="text-xs text-gray-500 mt-1">
                  Whether worker starts automatically on initialization
                </p>
              </div>
            </div>
          </template>
        </div>
      </div>
    </template>
  </USlideover>
</template>

<script setup lang="ts">
import { ref, computed } from '#imports'
import { USlideover, UTabs, UIcon } from '#components'

interface QueueConfig {
  name?: string
  prefix?: string
  limiter?: {
    max?: number
    duration?: number
    groupKey?: string
  }
  defaultJobOptions?: {
    attempts?: number
    backoff?: {
      type?: string
      delay?: number
    }
    priority?: number
    timeout?: number
    removeOnComplete?: boolean | number
    removeOnFail?: boolean | number
  }
}

interface WorkerConfig {
  concurrency?: number
  lockDurationMs?: number
  maxStalledCount?: number
  drainDelayMs?: number
  pollingIntervalMs?: number
  autorun?: boolean
}

interface Props {
  queueName: string
  queueConfig?: QueueConfig
  workerConfig?: WorkerConfig
}

const props = defineProps<Props>()

const isOpen = defineModel<boolean>('open', { default: false })
const selectedTab = ref('queue')

const tabs = [
  { label: 'Queue Config', value: 'queue', icon: 'i-lucide-list' },
  { label: 'Worker Config', value: 'worker', icon: 'i-lucide-cpu' },
]

const hasQueueConfig = computed(() => {
  if (!props.queueConfig) return false
  const { name, ...rest } = props.queueConfig
  return Object.values(rest).some(v => v !== undefined && v !== null)
})

const hasJobOptions = computed(() => {
  const opts = props.queueConfig?.defaultJobOptions
  if (!opts) return false
  return Object.values(opts).some(v => v !== undefined && v !== null)
})

const hasWorkerConfig = computed(() => {
  if (!props.workerConfig) return false
  return Object.values(props.workerConfig).some(v => v !== undefined && v !== null)
})
</script>
