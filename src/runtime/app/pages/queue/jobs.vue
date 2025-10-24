<template>
  <div>
    <div>
      <UButton
        label="Back"
        icon="i-heroicons-arrow-left"
        @click="back"
      />
    </div>
    <section>
      <div class="flex flex-col md:flex-row justify-between space-y-2 py-4">
        <div class="space-y-2">
          <div>
            <h1 class="text-xl font-bold">
              Queue - {{ queueName }}
            </h1>
            <p class="text-sm font-thin text-gray-500">
              Overview of all Jobs
            </p>
          </div>
          <div class="flex flex-row gap-2 md:justify-end">
            <div class="flex flex-row gap-2 md:justify-start">
              <UBadge
                variant="subtle"
                color="neutral"
              >
                State: {{ metrics?.paused ? 'Paused' : 'Running' }}
              </UBadge>
              <UBadge
                variant="subtle"
                color="warning"
              >
                Active: {{ metrics?.counts?.active || 0 }}
              </UBadge>
              <UBadge
                variant="subtle"
                color="neutral"
              >
                Waiting: {{ metrics?.counts?.waiting || 0 }}
              </UBadge>
              <UBadge
                variant="subtle"
                color="success"
              >
                Completed: {{ metrics?.counts?.completed || 0 }}
              </UBadge>
              <UBadge
                variant="subtle"
                color="error"
              >
                Failed: {{ metrics?.counts?.failed || 0 }}
              </UBadge>
            </div>
            <QueueStatCounter
              name="Active"
              color="yellow"
              :count="metrics?.counts?.active || 0"
            />
            <QueueStatCounter
              name="Waiting"
              color="neutral"
              :count="metrics?.counts?.waiting || 0"
            />
            <QueueStatCounter
              name="Completed"
              color="green"
              :count="metrics?.counts?.completed || 0"
            />
            <QueueStatCounter
              name="Failed"
              color="red"
              :count="metrics?.counts?.failed || 0"
            />
          </div>
        </div>
        <div class="flex flex-col justify-center space-y-2">
          <UModal
            key="create-job"
            title="Create new Job"
          >
            <UButton
              icon="i-heroicons-plus"
              color="neutral"
              variant="outline"
              class="cursor-pointer w-full"
              size="sm"
              @click="() => {}"
            >
              Create Job
            </UButton>
            <template #body>
              <UForm
                ref="jobForm"
                :schema="jobFormSchema"
                :state="newJobFormState"
                @submit="createJob"
              >
                <UFormField
                  label="Name"
                  name="name"
                >
                  <UInput
                    v-model="newJobFormState.name"
                    placeholder="Job Name"
                    class="w-full"
                  />
                </UFormField>
                <UFormField
                  label="Data"
                  name="jobData"
                >
                  <JsonEditorVue
                    v-model="newJobFormState.data"
                    :main-menu-bar="false"
                    mode="text"
                  />
                </UFormField>
              </UForm>
            </template>
            <template #footer>
              <div class="flex justify-end w-full">
                <UButton
                  type="submit"
                  color="neutral"
                  variant="outline"
                  class="cursor-pointer"
                  @click.prevent="handleCreateJob"
                >
                  Create
                </UButton>
              </div>
            </template>
          </UModal>
          <div>
            <UButton
              :icon="metrics?.paused ? 'i-heroicons-play' : 'i-heroicons-pause'"
              color="neutral"
              variant="outline"
              class="cursor-pointer w-full"
              size="sm"
              @click="togglePause()"
            >
              {{ metrics?.paused ? 'Resume queue' : 'Pause queue' }}
            </UButton>
          </div>
          <div class="flex gap-2">
            <UButton
              icon="i-heroicons-arrow-path"
              color="neutral"
              variant="outline"
              class="cursor-pointer"
              size="sm"
              @click="refreshMetrics()"
            >
              Refresh metrics
            </UButton>
            <UButton
              icon="i-heroicons-bolt"
              color="neutral"
              variant="outline"
              class="cursor-pointer"
              size="sm"
              @click="refreshJobs()"
            >
              Refresh jobs
            </UButton>
          </div>
          <USlideover
            title="Job Scheduling"
          >
            <UButton
              icon="i-heroicons-arrow-path-rounded-square"
              color="neutral"
              variant="outline"
              class="cursor-pointer"
              size="sm"
              @click="() => {}"
            >
              Job Scheduling
            </UButton>

            <template #body>
              <QueueJobScheduling :queue="queueName" />
            </template>
          </USlideover>
        </div>
      </div>
    </section>
    <section>
      <UCard
        class="w-full"
      >
        <!-- Filters -->
        <div class="flex items-center justify-end gap-3 px-4 py-3">
          <USelectMenu
            v-model="filters"
            :items="jobStates"
            placeholder="Job Satus"
            multiple
            class="w-40"
            @change="updateJobStateFilter"
          />
          <UButton
            icon="i-heroicons-funnel"
            color="neutral"
            class="cursor-pointer"
            size="xs"
            :disabled="filters.length === 0"
            @click="() => { filters = [] }"
          >
            Reset
          </UButton>
        </div>

        <!-- Header and Action buttons -->
        <div class="flex justify-end items-center w-full px-4 py-3">
          <div class="flex gap-1.5 items-center">
            <UDropdownMenu
              v-if="selectedRows.length > 1"
              :items="actions"
            >
              <UButton
                icon="i-heroicons-chevron-down"
                trailing
                class="cursor-pointer"
                color="neutral"
                size="xs"
              >
                Action
              </UButton>
            </UDropdownMenu>

            <UDropdownMenu
              :items="
                table?.tableApi
                  ?.getAllColumns()
                  .filter((column) => column.getCanHide())
                  .map((column) => ({
                    label: upperFirst(column.id),
                    type: 'checkbox' as const,
                    checked: column.getIsVisible(),
                    onUpdateChecked(checked: boolean) {
                      table?.tableApi?.getColumn(column.id)?.toggleVisibility(!!checked)
                    },
                    onSelect(e?: Event) {
                      e?.preventDefault()
                    },
                  }))
              "
              :content="{ align: 'end' }"
            >
              <UButton
                label="Columns"
                color="neutral"
                class="cursor-pointer"
                variant="outline"
                trailing-icon="i-lucide-chevron-down"
              />
            </UDropdownMenu>
          </div>
        </div>

        <UTable
          ref="table"
          v-model:column-visibility="columnVisibility"
          :sticky="true"
          :columns="columnsTable"
          :loading="status === 'pending'"
          :data="data.jobs"
          class="w-full flex-1 max-h-[612px]"
          @select="onSelectRow"
        />

        <template #footer>
          <div class="flex flex-wrap justify-between items-center">
            <div>
              <span class="text-sm leading-5">
                {{ data?.jobs?.length || 0 }} job(s)
              </span>
            </div>
          </div>
        </template>
      </UCard>
    </section>
  </div>
</template>

<script setup lang="ts">
import { z } from 'zod'
import type { Ref } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import { upperFirst } from 'scule'
import type { Job } from '../../types'
import type { Form, FormSubmitEvent } from '#ui/types'
import {
  useRoute,
  navigateTo,
  useFetch,
  ref,
  useQueueSubscription,
  computed,
  useTemplateRef,
  h,
  reactive,
  useComponentRouter,
} from '#imports'
import { UBadge, UProgress, UDropdownMenu, UButton } from '#components'

const route = useRoute()
const componentRouter = useComponentRouter()
const queueName = computed(() =>
  (componentRouter?.route?.value?.params?.name as string)
  || (route.query?.name as string)
  || '',
)

const { refresh } = await useFetch(`/api/_queues/${queueName.value}`, {
  method: 'GET',
})

// Per-queue metrics
const { data: metrics, refresh: refreshMetrics } = await useFetch(`/api/_queues/${queueName.value}/metrics`, {
  method: 'GET',
})

const table = useTemplateRef('table')

// Selected Rows
const selectedRows = ref([]) as Ref<Job[]>

async function back() {
  if (componentRouter?.pushTo) return componentRouter.pushTo('/queue')
  await navigateTo({ query: { tab: 'queue' } })
}

function select(id: string) {
  const name = queueName.value
  return componentRouter.pushTo('/queues/:name/jobs/:id', { name, id })
}

function onSelectRow(row: any) {
  const id = typeof row?.getValue === 'function' ? row.getValue('id') : (row?.original?.id || row?.id)
  if (id) select(id)
}

const jobStates = ['active', 'completed', 'delayed', 'failed', 'paused', 'prioritized', 'waiting', 'waiting-children']
const filters = ref([])
// Pagination currently not supported server-side; keep client defaults if needed

const updateJobStateFilter = () => {
  // No server-side pagination; trigger refresh if needed
  refreshJobs()
}

const {
  data,
  status,
  refresh: refreshJobs,
} = await useFetch(`/api/_queues/${queueName.value}/job`, {
  query: {
    // limit, page are currently ignored by the API
    filter: filters,
  },
})

const columns: TableColumn<Job>[] = [{
  accessorKey: 'id',
  header: 'ID',
}, {
  accessorKey: 'name',
  header: 'Name',
}, {
  accessorKey: 'state',
  header: 'State',
  cell: ({ row }) => {
    const color = {
      completed: 'success' as const,
      waiting: 'neutral' as const,
      added: 'info' as const,
      active: 'primary' as const,
      failed: 'error' as const,
    }[row.getValue('state') as string]

    return h(UBadge, { class: 'capitalize', variant: 'subtle', color }, () =>
      row.getValue('state'),
    )
  },
}, {
  accessorKey: 'progress',
  header: 'Progress',
  cell: ({ row }) => {
    return h(UProgress, {
      indicator: true,
      // @ts-ignore
      modelValue: row.getValue('progress'),
    })
  },
}, {
  accessorKey: 'timestamp',
  header: 'Created',
  cell: ({ row }) => {
    return new Date(row.getValue('timestamp')).toLocaleString('de', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  },
}, {
  accessorKey: 'finishedOn',
  header: 'Finished',
  cell: ({ row }) => {
    return row.getValue('finishedOn')
      ? new Date(row.getValue('finishedOn')).toLocaleString('de', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        })
      : '-'
  },
},
{
  id: 'actions',
  cell: ({ row }) => {
    return h(
      'div',
      { class: 'text-right' },
      h(
        (UDropdownMenu as any),
        {
          content: {
            align: 'end',
          },
          items: [{
            label: 'Details',
            onSelect: () => select(row.getValue('id')),
          }, {
            label: 'Retry',
            onSelect: () => {

            },
          }, {
            label: 'Remove',
            onSelect: () => {

            },
          }],
        },
        () =>
          h(UButton, {
            icon: 'i-lucide-ellipsis-vertical',
            color: 'neutral',
            variant: 'ghost',
            class: 'ml-auto cursor-pointer',
          }),
      ),
    )
  },
}]

const columnVisibility = ref({})
const selectedColumns = ref(columns)
const columnsTable = computed(() => columns.filter(column => selectedColumns.value.includes(column)))

// Retained for useQueueSubscription signature expecting string; freeze current name
const queueNameRef = ref(queueName.value) as Ref<string>

useQueueSubscription(queueNameRef.value, {
  onCompleted: (event) => {
    console.log(event)
    refresh()
    refreshJobs()
    refreshMetrics()
  },
  onFailed: (event) => {
    console.log(event)
    refresh()
    updateJob(event.jobId, 'state', 'failed')
    refreshMetrics()
  },
  onWaiting: (event) => {
    console.log(event)
    refresh()
    updateJob(event.jobId, 'state', 'waiting')
    refreshMetrics()
  },
  onActive: (event) => {
    console.log(event)
    refresh()
    updateJob(event.jobId, 'state', 'active')
    refreshMetrics()
  },
  onAdded: (event) => {
    console.log(event)
    refresh()
    refreshJobs()
    refreshMetrics()
  },
  onProgress: (event) => {
    console.log(event)
    refresh()
    // Currently update job is not working because of shallowRef used by tanstack table -> check out new way for updating manually
    // updateJob(event.jobId, 'progress', event?.data || 0)
    refreshJobs()
    refreshMetrics()
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

// Create new Job
const jobFormSchema = z.object({
  name: z.string().regex(/^\S*$/gm, 'No spaces allowed'),
  data: z.string().default('{}'),
})
const newJobFormState = reactive({
  name: undefined,
  data: undefined,
})
type JobFormSchema = z.output<typeof jobFormSchema>
const jobForm = ref<Form<JobFormSchema>>()
async function handleCreateJob() {
  await jobForm.value?.submit()
}
const createJob = async (event: FormSubmitEvent<JobFormSchema>) => {
  const resp = await $fetch<any>(`/api/_queues/${queueName.value}/job`, {
    method: 'POST',
    body: {
      name: event.data.name,
      data: event.data.data,
    },
  })
  const { page, ...query } = route.query
  navigateTo({
    query: {
      ...query,
      job: resp.id,
    },
  })
}

const togglePause = async () => {
  const paused = !!metrics.value?.paused
  const action = paused ? 'resume' : 'pause'
  await $fetch(`/api/_queues/${queueName.value}/${action}`, { method: 'POST' })
  await refreshMetrics()
}
</script>
