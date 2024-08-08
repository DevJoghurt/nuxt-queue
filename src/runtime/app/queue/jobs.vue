<template>
  <div class="px-8 py-6">
    <section class="flex justify-between py-4">
      <div>
        <h1 class="text-xl font-bold">
          Queue - {{ queueName }}
        </h1>
        <p class="text-sm font-thin text-gray-500">
          Overview of all Jobs
        </p>
      </div>
      <div>
        <div class="flex flex-row gap-4 justify-end">
          <QueueStatCounter
            name="Active"
            color="orange"
            :count="queue?.jobs.active"
          />
          <QueueStatCounter
            name="Waiting"
            color="yellow"
            :count="queue?.jobs.waiting"
          />
          <QueueStatCounter
            name="Completed"
            color="green"
            :count="queue?.jobs.completed"
          />
          <QueueStatCounter
            name="Failed"
            color="red"
            :count="queue?.jobs.failed"
          />
          <QueueStatCounter
            name="Worker"
            color="cyan"
            :count="queue?.worker"
          />
        </div>
      </div>
    </section>
    <section>
      <UCard
        class="w-full"
        :ui="{
          base: '',
          divide: 'divide-y divide-gray-200 dark:divide-gray-700',
          header: { padding: 'px-4 py-5' },
          body: { padding: '', base: 'divide-y divide-gray-200 dark:divide-gray-700' },
          footer: { padding: 'p-4' },
        }"
      >
        <!-- Filters -->
        <div class="flex items-center justify-end gap-3 px-4 py-3">
          <USelectMenu
            v-model="filters"
            :options="jobStates"
            multiple
            class="w-40"
          >
            <template #label>
              <span
                v-if="filters.length"
                class="truncate"
              >{{ filters.join(', ') }}</span>
              <span v-else>Filter</span>
            </template>
          </USelectMenu>
        </div>

        <!-- Header and Action buttons -->
        <div class="flex justify-between items-center w-full px-4 py-3">
          <div class="flex items-center gap-1.5">
            <span class="text-sm leading-5">Rows per page:</span>

            <USelect
              v-model="limit"
              :options="[10, 20, 30, 40, 50]"
              class="me-2 w-20"
              size="xs"
            />
          </div>

          <div class="flex gap-1.5 items-center">
            <UDropdown
              v-if="selectedRows.length > 1"
              :items="actions"
              :ui="{ width: 'w-36' }"
            >
              <UButton
                icon="i-heroicons-chevron-down"
                trailing
                color="gray"
                size="xs"
              >
                Action
              </UButton>
            </UDropdown>

            <USelectMenu
              v-model="selectedColumns"
              :options="columns"
              multiple
            >
              <UButton
                icon="i-heroicons-view-columns"
                color="gray"
                size="xs"
              >
                Columns
              </UButton>
            </USelectMenu>

            <UButton
              icon="i-heroicons-funnel"
              color="gray"
              size="xs"
              :disabled="filters.length === 0"
              @click="resetFilters"
            >
              Reset
            </UButton>
          </div>
        </div>

        <UTable
          v-model="selectedRows"
          :columns="columnsTable"
          :rows="data.jobs"
          :sort="{
            column: 'timestamp',
            direction: 'desc',
          }"
          :loading="pending"
          class="w-full"
          :ui="{
            td: {
              base: 'max-w-[0] truncate',
            },
          }"
          @select="select"
        >
          <template #timestamp-data="{ row }">
            <span>{{ new Date(row.timestamp).toLocaleString() }}</span>
          </template>
          <template #state-data="{ row }">
            <UBadge
              v-if="row.state === 'completed'"
              variant="subtle"
              color="green"
              size="sm"
            >
              {{ row.state }}
            </UBadge>
            <UBadge
              v-if="row.state === 'waiting'"
              variant="subtle"
              color="yellow"
              size="sm"
            >
              {{ row.state }}
            </UBadge>
            <UBadge
              v-if="row.state === 'failed'"
              variant="subtle"
              color="red"
              size="sm"
            >
              {{ row.state }}
            </UBadge>
            <UBadge
              v-if="row.state === 'active'"
              variant="subtle"
              color="orange"
              size="sm"
            >
              {{ row.state }}
            </UBadge>
          </template>
          <template #progress-data="{ row }">
            <UProgress
              :value="row.progress"
              indicator
            />
          </template>
          <template #finishedOn-data="{ row }">
            <span>{{ new Date(row.finishedOn).toLocaleString() }}</span>
          </template>
        </UTable>
        <template #footer>
          <div class="flex flex-wrap justify-between items-center">
            <div>
              <span class="text-sm leading-5">
                Showing
                <span class="font-medium">{{ page }}</span>
                to
                <span class="font-medium">{{ data.pageCount }}</span>
                of
                <span class="font-medium">{{ data.total }}</span>
                results
              </span>
            </div>
            <UPagination
              v-model="page"
              :page-count="data.limit"
              :total="data.total"
              :to="(page: number) => ({
                query: {
                  ...route.query,
                  page,
                },
              })"
            />
          </div>
        </template>
      </UCard>
    </section>
  </div>
</template>

<script setup lang="ts">
import type { Ref } from 'vue'
import type { QueueData, Job } from '../../types'
import {
  useRoute,
  navigateTo,
  useFetch,
  ref,
  useQueueSubscription,
  computed,
} from '#imports'

const route = useRoute()

const {
  data: queue,
  refresh,
} = await useFetch<QueueData>(`/api/_queue/${route.query?.name}`, {
  method: 'GET',
})

// Selected Rows
const selectedRows = ref([]) as Ref<Job[]>
function select(job: Job) {
  const { page, ...query } = route.query
  navigateTo({
    query: {
      ...query,
      job: job.id,
    },
  })
}

const jobStates = ['active', 'completed', 'delayed', 'failed', 'paused', 'prioritized', 'waiting', 'waiting-children']
const filters = ref([])
const page = ref(Number.parseInt(route.query?.page) || 1)
const limit = ref(Number.parseInt(route.query?.limit) || 20)

const resetFilters = () => {
  filters.value = []
}

const {
  data,
  pending,
  refresh: refreshJobs,
} = await useFetch(`/api/_queue/${route.query?.name}/job`, {
  query: {
    limit: limit,
    page: page,
    filter: filters,
  },
})

const columns = [{
  key: 'timestamp',
  label: 'Created',
  sortable: true,
}, {
  key: 'state',
  label: 'State',
}, {
  key: 'id',
  label: 'ID',
  sortable: true,
}, {
  key: 'name',
  label: 'Name',
  sortable: true,
}, {
  key: 'progress',
  label: 'Progress',
}, {
  key: 'finishedOn',
  label: 'Finished',
}]

const selectedColumns = ref(columns)
const columnsTable = computed(() => columns.filter(column => selectedColumns.value.includes(column)))

const queueName = ref(route.query?.name) as Ref<string>

useQueueSubscription(queueName.value, {
  onCompleted: (event) => {
    console.log(event)
    refresh()
    refreshJobs()
  },
  onFailed: (event) => {
    console.log(event)
    refresh()
    updateJob(event.id, 'state', 'failed')
  },
  onWaiting: (event) => {
    console.log(event)
    refresh()
    updateJob(event.id, 'state', 'waiting')
  },
  onActive: (event) => {
    console.log(event)
    refresh()
    updateJob(event.id, 'state', 'active')
  },
  onAdded: (event) => {
    console.log(event)
    refresh()
    refreshJobs()
  },
  onProgress: (event) => {
    console.log(event)
    updateJob(event.id, 'progress', event.progress)
  },
})

const updateJob = (jobId: string | number, key: string, value: any) => {
  if (data.value?.jobs && data.value.jobs.length > 0) {
    for (const job of data.value.jobs) {
      if (jobId === job.id) {
        job[key] = value
      }
    }
  }
}

// Actions
const actions = [
  [{
    key: 'completed',
    label: 'Completed',
    icon: 'i-heroicons-check',
  }], [{
    key: 'uncompleted',
    label: 'In Progress',
    icon: 'i-heroicons-arrow-path',
  }],
]
</script>
