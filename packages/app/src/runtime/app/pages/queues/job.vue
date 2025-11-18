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
              {{ job?.name || 'Job Details' }}
            </h1>
            <p class="text-xs text-gray-500 font-mono">
              {{ job?.id }}
            </p>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <UBadge
            v-if="job?.state"
            :label="job.state"
            :color="stateColor"
            variant="subtle"
            class="capitalize"
          />
          <UButton
            icon="i-lucide-refresh-cw"
            size="xs"
            color="neutral"
            variant="ghost"
            @click="() => refresh()"
          >
            Refresh
          </UButton>
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex-1 min-h-0 overflow-y-auto px-6 py-4">
      <div
        v-if="!job"
        class="h-full flex items-center justify-center text-sm text-gray-400"
      >
        Job not found
      </div>
      <div
        v-else
        class="space-y-6"
      >
        <!-- Job Info Grid -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <UCard>
            <template #header>
              <h2 class="text-sm font-semibold">
                Job Info
              </h2>
            </template>
            <div class="space-y-3">
              <div>
                <p class="text-xs text-gray-500">
                  ID
                </p>
                <p class="text-sm font-medium font-mono">
                  {{ job.id }}
                </p>
              </div>
              <div>
                <p class="text-xs text-gray-500">
                  Name
                </p>
                <p class="text-sm font-medium">
                  {{ job.name }}
                </p>
              </div>
              <div>
                <p class="text-xs text-gray-500">
                  State
                </p>
                <p class="text-sm font-medium capitalize">
                  {{ job.state || 'unknown' }}
                </p>
              </div>
            </div>
          </UCard>

          <UCard>
            <template #header>
              <h2 class="text-sm font-semibold">
                Timing
              </h2>
            </template>
            <div class="space-y-4">
              <!-- Timestamps -->
              <div class="grid grid-cols-1 gap-3">
                <div class="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800">
                  <p class="text-xs text-gray-500">
                    Created
                  </p>
                  <p class="text-sm font-medium">
                    {{ formatDate(job.timestamp) }}
                  </p>
                </div>
                <div
                  v-if="job.processedOn"
                  class="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800"
                >
                  <p class="text-xs text-gray-500">
                    Processed
                  </p>
                  <p class="text-sm font-medium">
                    {{ formatDate(job.processedOn) }}
                  </p>
                </div>
                <div
                  v-if="job.finishedOn"
                  class="flex items-center justify-between py-2"
                >
                  <p class="text-xs text-gray-500">
                    Finished
                  </p>
                  <p class="text-sm font-medium">
                    {{ formatDate(job.finishedOn) }}
                  </p>
                </div>
              </div>

              <!-- Durations -->
              <div
                v-if="waitDuration || executionDuration"
                class="pt-2 mt-2 border-t border-gray-200 dark:border-gray-700"
              >
                <div class="grid grid-cols-2 gap-3">
                  <div
                    v-if="waitDuration"
                    class="text-center p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg"
                  >
                    <p class="text-xs text-gray-500 mb-1">
                      Wait Time
                    </p>
                    <p class="text-lg font-semibold text-blue-600 dark:text-blue-400">
                      {{ waitDuration }}
                    </p>
                  </div>
                  <div
                    v-if="executionDuration"
                    class="text-center p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg"
                  >
                    <p class="text-xs text-gray-500 mb-1">
                      {{ job.state === 'active' ? 'Running' : 'Execution' }}
                    </p>
                    <p
                      class="text-lg font-semibold"
                      :class="job.state === 'active' ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'"
                    >
                      {{ executionDuration }}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </UCard>
        </div>

        <!-- Job Data -->
        <UCard>
          <template #header>
            <h2 class="text-sm font-semibold">
              Job Data
            </h2>
          </template>
          <pre class="text-xs overflow-x-auto bg-gray-50 dark:bg-gray-900 p-4 rounded">{{ JSON.stringify(job.data, null, 2) }}</pre>
        </UCard>

        <!-- Return Value -->
        <UCard v-if="job.returnvalue">
          <template #header>
            <h2 class="text-sm font-semibold">
              Return Value
            </h2>
          </template>
          <pre class="text-xs overflow-x-auto bg-gray-50 dark:bg-gray-900 p-4 rounded">{{ JSON.stringify(job.returnvalue, null, 2) }}</pre>
        </UCard>

        <!-- Error -->
        <UCard v-if="job.failedReason">
          <template #header>
            <h2 class="text-sm font-semibold text-red-500">
              Error
            </h2>
          </template>
          <div class="text-sm text-red-600 dark:text-red-400">
            {{ job.failedReason }}
          </div>
        </UCard>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, useFetch } from '#imports'
import { UCard, UButton, UBadge } from '#components'
import { useComponentRouter } from '../../composables/useComponentRouter'
import type { Job } from '../../composables/useQueueJobs'

const router = useComponentRouter()
const queueName = computed(() => router.route.value?.params?.name as string || '')
const jobId = computed(() => router.route.value?.params?.id as string || '')

const { data: job, refresh } = await useFetch<Job>(
  () => `/api/_queues/${encodeURIComponent(queueName.value)}/job/${encodeURIComponent(jobId.value)}`,
  {
    server: false,
  },
)

const stateColor = computed<'neutral' | 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error'>(() => {
  const colorMap: Record<string, 'neutral' | 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error'> = {
    waiting: 'info',
    active: 'warning',
    completed: 'success',
    failed: 'error',
    delayed: 'secondary',
    paused: 'warning',
  }
  return colorMap[job.value?.state || ''] || 'neutral'
})

const waitDuration = computed(() => {
  if (!job.value?.timestamp || !job.value?.processedOn) return null
  const waitMs = job.value.processedOn - job.value.timestamp
  return formatDuration(waitMs)
})

const executionDuration = computed(() => {
  if (!job.value?.processedOn) return null
  const endTime = job.value.finishedOn || Date.now()
  const execMs = endTime - job.value.processedOn
  return formatDuration(execMs)
})

const back = () => {
  router.push(`/queues/${queueName.value}/jobs`)
}

const formatDuration = (ms: number) => {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`
  if (ms < 3600000) return `${(ms / 60000).toFixed(2)}m`
  return `${(ms / 3600000).toFixed(2)}h`
}

const formatDate = (timestamp: string | number | Date | undefined) => {
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
</script>
