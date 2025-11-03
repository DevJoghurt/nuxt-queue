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
            <span
              v-if="isAutoRefreshing"
              class="text-[10px] text-gray-400"
            >
              (updating...)
            </span>
          </div>
          <div
            v-else-if="isReconnecting"
            class="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400"
          >
            <div class="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <span>Reconnecting...</span>
          </div>
          <UBadge
            :label="counts?.active.toString() || '0'"
            color="warning"
            variant="subtle"
          >
            <template #leading>
              Active
            </template>
          </UBadge>
          <UBadge
            :label="counts?.waiting.toString() || '0'"
            color="info"
            variant="subtle"
          >
            <template #leading>
              Waiting
            </template>
          </UBadge>
          <UBadge
            :label="counts?.completed.toString() || '0'"
            color="success"
            variant="subtle"
          >
            <template #leading>
              Completed
            </template>
          </UBadge>
          <UBadge
            :label="counts?.failed.toString() || '0'"
            color="error"
            variant="subtle"
          >
            <template #leading>
              Failed
            </template>
          </UBadge>
          <USelectMenu
            v-model="selectedStateOption"
            :items="stateOptions"
            placeholder="All States"
            size="xs"
            class="w-32"
          />
          <UButton
            icon="i-lucide-refresh-cw"
            size="xs"
            color="neutral"
            variant="ghost"
            :loading="status === 'pending'"
            @click.prevent="onRefresh"
          >
            Refresh
          </UButton>
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex-1 min-h-0 overflow-hidden flex flex-col">
      <div
        v-if="!data || !data.jobs || data.jobs.length === 0"
        class="flex-1 flex items-center justify-center text-sm text-gray-400"
      >
        No jobs found
      </div>
      <template v-else>
        <div class="flex-1 min-h-0 p-4 overflow-auto">
          <UTable
            ref="table"
            v-model:pagination="pagination"
            :data="data.jobs"
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

        <div class="flex items-center justify-between gap-3 border-t border-default p-4 shrink-0">
          <div class="text-sm text-muted">
            Showing {{ Math.min(pagination.pageIndex * pagination.pageSize + pagination.pageSize, data.jobs.length) }} of {{ data.jobs.length }} job(s)
            <span
              v-if="selectedState"
              class="text-gray-400"
            >
              (filtered by {{ selectedStateOption?.label }})
            </span>
          </div>
          <div class="flex items-center gap-1.5">
            <UPagination
              :default-page="(table?.tableApi?.getState().pagination.pageIndex || 0) + 1"
              :items-per-page="table?.tableApi?.getState().pagination.pageSize || 20"
              :total="data.jobs.length"
              @update:page="(p: number) => table?.tableApi?.setPageIndex(p - 1)"
            />
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from '#imports'
import type { TableColumn } from '@nuxt/ui'
import { getPaginationRowModel } from '@tanstack/table-core'
import { UTable, UButton, UBadge, UPagination, USelectMenu } from '#components'
import { useQueueJobs, type Job } from '../../composables/useQueueJobs'
import { useQueueUpdates } from '../../composables/useQueueUpdates'
import { useComponentRouter } from '../../composables/useComponentRouter'

const UBadgeComponent = resolveComponent('UBadge')
const UButtonComponent = resolveComponent('UButton')

const router = useComponentRouter()
const queueName = computed(() => router.route.value?.params?.name as string || '')

const stateOptions = [
  { label: 'All States', value: null },
  { label: 'Waiting', value: 'waiting' },
  { label: 'Active', value: 'active' },
  { label: 'Completed', value: 'completed' },
  { label: 'Failed', value: 'failed' },
  { label: 'Delayed', value: 'delayed' },
  { label: 'Paused', value: 'paused' },
]

const selectedStateOption = ref(stateOptions[0])

// Extract the value from the selected option
const selectedState = computed(() => selectedStateOption.value?.value ?? null)

const { data, refresh, status } = useQueueJobs(queueName, selectedState)
const { counts, isConnected, isReconnecting, shouldRefreshJobs, resetRefreshFlag } = useQueueUpdates(queueName)

const isAutoRefreshing = ref(false)

// Watch for state filter changes and reset to first page
watch(selectedState, () => {
  // Reset table pagination to first page
  if (table.value?.tableApi) {
    table.value.tableApi.setPageIndex(0)
  }
})

// Watch for shouldRefreshJobs flag and auto-refresh the job list
watch(shouldRefreshJobs, async (shouldRefresh) => {
  if (shouldRefresh) {
    isAutoRefreshing.value = true
    await refresh()
    resetRefreshFlag()
    // Keep the indicator visible for a brief moment
    setTimeout(() => {
      isAutoRefreshing.value = false
    }, 500)
  }
})

const table = useTemplateRef('table')
const pagination = ref({
  pageIndex: 0,
  pageSize: 20,
})

const onRefresh = async () => {
  // ignore the MouseEvent parameter and call the composable refresh
  await refresh()
}

const back = () => {
  router.push('/queues')
}

const selectJob = (jobId: string) => {
  router.push(`/queues/${queueName.value}/jobs/${jobId}`)
}

const columns: TableColumn<Job>[] = [
  {
    accessorKey: 'id',
    header: 'Job ID',
    cell: ({ row }) => {
      const id = row.original.id
      return h('div', {
        class: 'font-mono text-xs cursor-pointer hover:underline',
        onClick: () => selectJob(row.original.id),
      }, id.length > 16 ? `${id.substring(0, 8)}...${id.substring(id.length - 8)}` : id)
    },
  },
  {
    accessorKey: 'name',
    header: 'Name',
    cell: ({ row }) => {
      return h('div', {
        class: 'font-medium cursor-pointer hover:underline',
        onClick: () => selectJob(row.original.id),
      }, row.original.name)
    },
  },
  {
    accessorKey: 'state',
    header: 'State',
    cell: ({ row }) => {
      const state = row.original.state
      const colorMap: Record<string, 'neutral' | 'info' | 'warning' | 'success' | 'error' | 'secondary'> = {
        waiting: 'info',
        active: 'warning',
        completed: 'success',
        failed: 'error',
        delayed: 'secondary',
        paused: 'warning',
      }
      return h(UBadgeComponent, {
        label: state || 'unknown',
        color: colorMap[state || ''] || 'neutral',
        variant: 'subtle',
        class: 'capitalize',
      })
    },
  },
  {
    accessorKey: 'timestamp',
    header: 'Created',
    cell: ({ row }) => {
      const timestamp = row.original.timestamp
      if (!timestamp) return h('div', { class: 'text-gray-400 text-xs' }, '-')
      const date = new Date(timestamp)
      return h('div', { class: 'text-xs' },
        date.toLocaleString('de-DE', {
          timeZone: 'Europe/Berlin',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      )
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
          selectJob(row.original.id)
        },
      })
    },
  },
]
</script>

