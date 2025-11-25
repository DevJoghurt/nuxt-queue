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

        <!-- Queues Table -->
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
          <UTable
            :data="paginatedQueues"
            :columns="columns"
            :ui="{
              wrapper: 'relative overflow-x-auto',
              base: 'w-full',
              thead: 'bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-800',
              tbody: 'divide-y divide-gray-200 dark:divide-gray-800',
              tr: {
                base: 'hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors cursor-pointer',
              },
              th: {
                base: 'px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider',
              },
              td: {
                base: 'px-6 py-4',
              },
            }"
          />

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

    <!-- Config Details Slideover -->
    <QueueConfigDetails
      v-if="selectedQueueForConfig"
      v-model:open="configDetailsOpen"
      :queue-name="selectedQueueForConfig.name"
      :queue-config="selectedQueueForConfig.config?.queue"
      :worker-config="selectedQueueForConfig.config?.worker"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, h, resolveComponent } from '#imports'
import type { TableColumn } from '@nuxt/ui'
import { UIcon, UPagination, UTable } from '#components'
import { useQueues, type QueueInfo } from '../../composables/useQueues'
import { useQueuesLive } from '../../composables/useQueuesLive'
import { useComponentRouter } from '../../composables/useComponentRouter'
import QueueConfigDetails from '../../components/QueueConfigDetails.vue'
import StatCard from '../../components/StatCard.vue'
import LiveIndicator from '../../components/LiveIndicator.vue'

const UBadgeComponent = resolveComponent('UBadge')
const UButtonComponent = resolveComponent('UButton')
const UIconComponent = resolveComponent('UIcon')

const { queues } = useQueues()
const { queues: queuesWithLive, isConnected, isReconnecting } = useQueuesLive(queues)
const router = useComponentRouter()

const configDetailsOpen = ref(false)
const selectedQueueForConfig = ref<QueueInfo | null>(null)

const openConfigDetails = (queue: QueueInfo) => {
  selectedQueueForConfig.value = queue
  configDetailsOpen.value = true
}

const selectQueue = (queueName: string) => {
  router.push(`/queues/${queueName}/jobs`)
}

// Table columns with cell renderers
const columns: TableColumn<QueueInfo>[] = [
  {
    accessorKey: 'name',
    header: 'Queue Name',
    cell: ({ row }) => {
      return h('div', { class: 'flex items-center gap-2 cursor-pointer', onClick: () => selectQueue(row.original.name) }, [
        h(UIconComponent, { name: 'i-lucide-inbox', class: 'w-4 h-4 shrink-0 text-blue-500' }),
        h('span', { class: 'text-sm font-semibold text-gray-900 dark:text-gray-100' }, row.original.name),
      ])
    },
  },
  {
    accessorKey: 'counts.waiting',
    header: 'Waiting',
    cell: ({ row }) => {
      const count = row.original.counts.waiting
      return h('div', { class: 'flex justify-center' }, [
        h('div', {
          class: `flex items-center justify-center min-w-[3rem] h-7 rounded text-sm font-medium px-2 ${
            count > 0
              ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400'
              : 'bg-gray-50 dark:bg-gray-900/50 text-gray-400 dark:text-gray-600'
          }`,
        }, String(count)),
      ])
    },
  },
  {
    accessorKey: 'counts.active',
    header: 'Active',
    cell: ({ row }) => {
      const count = row.original.counts.active
      return h('div', { class: 'flex justify-center' }, [
        h('div', {
          class: `flex items-center justify-center min-w-[3rem] h-7 rounded text-sm font-medium px-2 ${
            count > 0
              ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400'
              : 'bg-gray-50 dark:bg-gray-900/50 text-gray-400 dark:text-gray-600'
          }`,
        }, String(count)),
      ])
    },
  },
  {
    accessorKey: 'counts.completed',
    header: 'Completed',
    cell: ({ row }) => {
      const count = row.original.counts.completed
      return h('div', { class: 'flex justify-center' }, [
        h('div', {
          class: `flex items-center justify-center min-w-[3rem] h-7 rounded text-sm font-medium px-2 ${
            count > 0
              ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400'
              : 'bg-gray-50 dark:bg-gray-900/50 text-gray-400 dark:text-gray-600'
          }`,
        }, String(count)),
      ])
    },
  },
  {
    accessorKey: 'counts.failed',
    header: 'Failed',
    cell: ({ row }) => {
      const count = row.original.counts.failed
      return h('div', { class: 'flex justify-center' }, [
        h('div', {
          class: `flex items-center justify-center min-w-[3rem] h-7 rounded text-sm font-medium px-2 ${
            count > 0
              ? 'bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400'
              : 'bg-gray-50 dark:bg-gray-900/50 text-gray-400 dark:text-gray-600'
          }`,
        }, String(count)),
      ])
    },
  },
  {
    accessorKey: 'counts.delayed',
    header: 'Delayed',
    cell: ({ row }) => {
      const count = row.original.counts.delayed
      return h('div', { class: 'flex justify-center' }, [
        h('div', {
          class: `flex items-center justify-center min-w-[3rem] h-7 rounded text-sm font-medium px-2 ${
            count > 0
              ? 'bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400'
              : 'bg-gray-50 dark:bg-gray-900/50 text-gray-400 dark:text-gray-600'
          }`,
        }, String(count)),
      ])
    },
  },
  {
    accessorKey: 'isPaused',
    header: 'Status',
    cell: ({ row }) => {
      return h('div', { class: 'flex justify-center' }, [
        h(UBadgeComponent, {
          label: row.original.isPaused ? 'Paused' : 'Running',
          color: row.original.isPaused ? 'warning' : 'success',
          variant: 'subtle',
          size: 'xs',
        }),
      ])
    },
  },
  {
    id: 'actions',
    header: 'Actions',
    cell: ({ row }) => {
      return h('div', { class: 'flex justify-center gap-1' }, [
        h(UButtonComponent, {
          icon: 'i-lucide-settings',
          size: 'xs',
          color: 'neutral',
          variant: 'ghost',
          square: true,
          title: 'View configuration',
          onClick: (e: Event) => {
            e.stopPropagation()
            openConfigDetails(row.original)
          },
        }),
        h(UButtonComponent, {
          icon: 'i-lucide-arrow-right',
          size: 'xs',
          color: 'neutral',
          variant: 'ghost',
          square: true,
        }),
      ])
    },
  },
]

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
