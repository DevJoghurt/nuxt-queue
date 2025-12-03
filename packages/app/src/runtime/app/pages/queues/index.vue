<template>
  <div class="h-full flex flex-col overflow-hidden">
    <!-- Header -->
    <div class="border-b border-gray-200 dark:border-gray-800 px-6 py-3 shrink-0">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-4">
          <h1 class="text-lg font-semibold">
            Queues
          </h1>
        </div>
        <LiveIndicator
          :is-connected="isConnected"
          :is-reconnecting="isReconnecting"
        />
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex-1 min-h-0 overflow-y-auto">
      <div class="max-w-7xl mx-auto p-6">
        <!-- Stats Overview -->
        <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <StatCard
            icon="i-lucide-inbox"
            :count="queuesWithLive?.length || 0"
            label="Total Queues"
            variant="gray"
          />
          <StatCard
            icon="i-lucide-clock"
            :count="totalWaiting"
            label="Waiting"
            variant="blue"
          />
          <StatCard
            icon="i-lucide-loader-2"
            :count="totalActive"
            label="Active"
            variant="amber"
          />
          <StatCard
            icon="i-lucide-check-circle"
            :count="totalCompleted"
            label="Completed"
            variant="emerald"
          />
          <StatCard
            icon="i-lucide-x-circle"
            :count="totalFailed"
            label="Failed"
            variant="red"
          />
        </div>

        <!-- Queues List -->
        <div
          v-if="!queuesWithLive || queuesWithLive.length === 0"
          class="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-8 text-center text-gray-500"
        >
          <UIcon
            name="i-lucide-inbox"
            class="w-12 h-12 mx-auto mb-3 opacity-50"
          />
          <div>No queues found</div>
        </div>
        <div
          v-else
          class="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden"
        >
          <div class="divide-y divide-gray-100 dark:divide-gray-800">
            <div
              v-for="queue in paginatedQueues"
              :key="queue.name"
              class="px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors cursor-pointer"
              @click="selectQueue(queue.name)"
            >
              <div class="flex items-start justify-between gap-4">
                <!-- Left: Queue Info -->
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-2">
                    <UIcon
                      name="i-lucide-inbox"
                      class="w-4 h-4 shrink-0 text-blue-500"
                    />
                    <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                      {{ queue.name }}
                    </h3>
                    <UBadge
                      :label="queue.isPaused ? 'Paused' : 'Running'"
                      :color="queue.isPaused ? 'warning' : 'success'"
                      variant="subtle"
                      size="xs"
                    />
                  </div>

                  <div class="flex items-center gap-4 text-xs">
                    <div
                      class="flex items-center gap-1"
                      :class="queue.counts.waiting > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-600'"
                    >
                      <UIcon
                        name="i-lucide-clock"
                        class="w-3 h-3"
                      />
                      <span>{{ queue.counts.waiting }} waiting</span>
                    </div>
                    <div
                      class="flex items-center gap-1"
                      :class="queue.counts.active > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-gray-600'"
                    >
                      <UIcon
                        name="i-lucide-loader-2"
                        class="w-3 h-3"
                      />
                      <span>{{ queue.counts.active }} active</span>
                    </div>
                    <div
                      class="flex items-center gap-1"
                      :class="queue.counts.completed > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-gray-600'"
                    >
                      <UIcon
                        name="i-lucide-check-circle"
                        class="w-3 h-3"
                      />
                      <span>{{ queue.counts.completed }} completed</span>
                    </div>
                    <div
                      class="flex items-center gap-1"
                      :class="queue.counts.failed > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400 dark:text-gray-600'"
                    >
                      <UIcon
                        name="i-lucide-x-circle"
                        class="w-3 h-3"
                      />
                      <span>{{ queue.counts.failed }} failed</span>
                    </div>
                    <div
                      class="flex items-center gap-1"
                      :class="queue.counts.delayed > 0 ? 'text-purple-600 dark:text-purple-400' : 'text-gray-400 dark:text-gray-600'"
                    >
                      <UIcon
                        name="i-lucide-timer"
                        class="w-3 h-3"
                      />
                      <span>{{ queue.counts.delayed }} delayed</span>
                    </div>
                  </div>
                </div>

                <!-- Right: Actions -->
                <div class="flex items-center gap-3">
                  <!-- Arrow Button -->
                  <UButton
                    icon="i-lucide-arrow-right"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    square
                  />
                </div>
              </div>
            </div>
          </div>

          <!-- Pagination -->
          <div
            v-if="totalPages > 1"
            class="border-t border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center justify-center"
          >
            <UPagination
              v-model="currentPage"
              :total="queuesWithLive.length"
              :items-per-page="itemsPerPage"
            />
          </div>
        </div>

        <!-- Footer Info -->
        <div
          v-if="queuesWithLive && queuesWithLive.length > 0"
          class="mt-4 text-center text-sm text-gray-500 dark:text-gray-400"
        >
          Showing {{ startIndex + 1 }}-{{ endIndex }} of {{ queuesWithLive.length }} queue{{ queuesWithLive.length === 1 ? '' : 's' }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from '#imports'
import { useQueues } from '../../composables/useQueues'
import { useQueuesLive } from '../../composables/useQueuesLive'
import { useComponentRouter } from '../../composables/useComponentRouter'
import StatCard from '../../components/StatCard.vue'
import LiveIndicator from '../../components/LiveIndicator.vue'

const { queues } = useQueues()
const { queues: queuesWithLive, isConnected, isReconnecting } = useQueuesLive(queues)
const router = useComponentRouter()

const selectQueue = (queueName: string) => {
  router.push(`/queues/${queueName}/jobs`)
}

// Pagination
const currentPage = ref(1)
const itemsPerPage = 10

const totalPages = computed(() => {
  if (!queuesWithLive.value) return 0
  return Math.ceil(queuesWithLive.value.length / itemsPerPage)
})

const startIndex = computed(() => {
  return (currentPage.value - 1) * itemsPerPage
})

const endIndex = computed(() => {
  if (!queuesWithLive.value) return 0
  return Math.min(startIndex.value + itemsPerPage, queuesWithLive.value.length)
})

const paginatedQueues = computed(() => {
  if (!queuesWithLive.value) return []
  return queuesWithLive.value.slice(startIndex.value, endIndex.value)
})

// Stats
const totalWaiting = computed(() => {
  if (!queuesWithLive.value) return 0
  return queuesWithLive.value.reduce((sum, q) => sum + q.counts.waiting, 0)
})

const totalActive = computed(() => {
  if (!queuesWithLive.value) return 0
  return queuesWithLive.value.reduce((sum, q) => sum + q.counts.active, 0)
})

const totalCompleted = computed(() => {
  if (!queuesWithLive.value) return 0
  return queuesWithLive.value.reduce((sum, q) => sum + q.counts.completed, 0)
})

const totalFailed = computed(() => {
  if (!queuesWithLive.value) return 0
  return queuesWithLive.value.reduce((sum, q) => sum + q.counts.failed, 0)
})
</script>
