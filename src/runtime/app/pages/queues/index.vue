<template>
  <div class="h-full flex flex-col overflow-hidden">
    <!-- Header -->
    <div class="border-b border-gray-200 dark:border-gray-800 px-6 py-3 shrink-0">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-4">
          <h1 class="text-lg font-semibold">
            Queues
          </h1>
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
        </div>
        <div class="flex items-center gap-3">
          <ClientOnly>
            <UButton
              icon="i-lucide-refresh-cw"
              size="xs"
              color="neutral"
              variant="ghost"
              :loading="status === 'pending'"
              @click="refresh"
            >
              Refresh
            </UButton>
          </ClientOnly>
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex-1 min-h-0 overflow-hidden flex flex-col">
      <div
        v-if="!queuesWithLive || queuesWithLive.length === 0"
        class="flex-1 flex items-center justify-center text-sm text-gray-400"
      >
        No queues found
      </div>
      <template v-else>
        <div class="flex-1 min-h-0 p-4 overflow-auto">
          <UTable
            ref="table"
            v-model:pagination="pagination"
            :data="queuesWithLive"
            :columns="columns"
            :loading="status === 'pending'"
            :pagination-options="{
              getPaginationRowModel: getPaginationRowModel(),
            }"
            :ui="{
              base: 'table-fixed border-separate border-spacing-0',
              thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
              tbody: '[&>tr]:last:[&>td]:border-b-0',
              th: 'py-2 first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
              td: 'border-b border-default',
              separator: 'h-0',
            }"
          />
        </div>

        <div class="flex items-center justify-between gap-3 border-t border-default p-4 mt-4 shrink-0">
          <div class="text-sm text-muted">
            {{ queuesWithLive.length }} queue{{ queuesWithLive.length === 1 ? '' : 's' }}
          </div>
          <div class="flex items-center gap-1.5">
            <UPagination
              :default-page="(table?.tableApi?.getState().pagination.pageIndex || 0) + 1"
              :items-per-page="table?.tableApi?.getState().pagination.pageSize"
              :total="queuesWithLive.length"
              @update:page="(p: number) => table?.tableApi?.setPageIndex(p - 1)"
            />
          </div>
        </div>
      </template>
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
import { ref } from '#imports'
import type { TableColumn } from '@nuxt/ui'
import { getPaginationRowModel } from '@tanstack/table-core'
import { UTable, UButton, UPagination } from '#components'
import { useQueues, type QueueInfo } from '../../composables/useQueues'
import { useQueuesLive } from '../../composables/useQueuesLive'
import { useComponentRouter } from '../../composables/useComponentRouter'
import QueueConfigDetails from '../../components/QueueConfigDetails.vue'

const UBadgeComponent = resolveComponent('UBadge')
const UButtonComponent = resolveComponent('UButton')

const { queues, refresh, status } = useQueues()
const { queues: queuesWithLive, isConnected, isReconnecting } = useQueuesLive(queues)
const router = useComponentRouter()

const table = useTemplateRef('table')
const pagination = ref({
  pageIndex: 0,
  pageSize: 10,
})

const configDetailsOpen = ref(false)
const selectedQueueForConfig = ref<QueueInfo | null>(null)

const openConfigDetails = (queue: QueueInfo) => {
  selectedQueueForConfig.value = queue
  configDetailsOpen.value = true
}

const columns: TableColumn<QueueInfo>[] = [
  {
    accessorKey: 'name',
    header: 'Queue Name',
    cell: ({ row }) => {
      return h('div', {
        class: 'font-medium text-highlighted cursor-pointer hover:underline',
        onClick: () => router.push(`/queues/${row.original.name}/jobs`),
      }, row.original.name)
    },
  },

  {
    accessorKey: 'counts.waiting',
    header: 'Waiting',
    cell: ({ row }) => {
      const count = row.original.counts.waiting
      return h('div', {
        class: `flex items-center justify-center w-12 h-7 rounded text-sm font-medium ${
          count > 0
            ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400'
            : 'bg-gray-50 dark:bg-gray-900/50 text-gray-400 dark:text-gray-600'
        }`,
      }, String(count))
    },
  },
  {
    accessorKey: 'counts.active',
    header: 'Active',
    cell: ({ row }) => {
      const count = row.original.counts.active
      return h('div', {
        class: `flex items-center justify-center w-12 h-7 rounded text-sm font-medium ${
          count > 0
            ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400'
            : 'bg-gray-50 dark:bg-gray-900/50 text-gray-400 dark:text-gray-600'
        }`,
      }, String(count))
    },
  },
  {
    accessorKey: 'counts.completed',
    header: 'Completed',
    cell: ({ row }) => {
      const count = row.original.counts.completed
      return h('div', {
        class: `flex items-center justify-center w-12 h-7 rounded text-sm font-medium ${
          count > 0
            ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400'
            : 'bg-gray-50 dark:bg-gray-900/50 text-gray-400 dark:text-gray-600'
        }`,
      }, String(count))
    },
  },
  {
    accessorKey: 'counts.failed',
    header: 'Failed',
    cell: ({ row }) => {
      const count = row.original.counts.failed
      return h('div', {
        class: `flex items-center justify-center w-12 h-7 rounded text-sm font-medium ${
          count > 0
            ? 'bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400'
            : 'bg-gray-50 dark:bg-gray-900/50 text-gray-400 dark:text-gray-600'
        }`,
      }, String(count))
    },
  },
  {
    accessorKey: 'counts.delayed',
    header: 'Delayed',
    cell: ({ row }) => {
      const count = row.original.counts.delayed
      return h('div', {
        class: `flex items-center justify-center w-12 h-7 rounded text-sm font-medium ${
          count > 0
            ? 'bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400'
            : 'bg-gray-50 dark:bg-gray-900/50 text-gray-400 dark:text-gray-600'
        }`,
      }, String(count))
    },
  },
  {
    accessorKey: 'isPaused',
    header: 'Status',
    cell: ({ row }) => {
      return h(UBadgeComponent, {
        label: row.original.isPaused ? 'Paused' : 'Running',
        color: row.original.isPaused ? 'warning' : 'success',
        variant: 'subtle',
      })
    },
  },
  {
    id: 'config',
    header: 'Config',
    cell: ({ row }) => {
      return h(UButtonComponent, {
        icon: 'i-lucide-settings',
        size: 'xs',
        color: 'neutral',
        variant: 'ghost',
        square: true,
        title: 'View configuration',
        onClick: () => {
          openConfigDetails(row.original)
        },
      })
    },
  },
  {
    id: 'actions',
    header: '',
    cell: ({ row }) => {
      return h(UButtonComponent, {
        icon: 'i-lucide-arrow-right',
        size: 'xs',
        color: 'neutral',
        variant: 'ghost',
        square: true,
        onClick: () => {
          router.push(`/queues/${row.original.name}/jobs`)
        },
      })
    },
  },
]
</script>

