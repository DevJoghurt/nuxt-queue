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
            <QueueStatCounter
              name="Active"
              color="yellow"
              :count="queue?.jobs.active"
            />
            <QueueStatCounter
              name="Waiting"
              color="neutral"
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
          </div>
        </div>
        <div class="flex flex-col justify-center space-y-2">
          <UModal
            title="Create new Job"
            key="create-job"
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
              icon="i-heroicons-play"
              color="neutral"
              variant="outline"
              class="cursor-pointer w-full"
              size="sm"
              @click="() => {}"
            >
              Worker {{ queue?.worker }}
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
              <QueueJobScheduling :queue="queue?.name" />
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
        <div class="flex justify-between items-center w-full px-4 py-3">
          <div class="flex items-center gap-1.5">
            <span class="text-sm leading-5">Rows per page:</span>

            <USelect
              v-model="limit"
              :items="[10, 20, 30, 40, 50]"
              class="me-2 w-20"
              size="xs"
            />
          </div>

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
          @select="select"
        />

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
              v-model:page="page"
              :items-per-page="data.limit"
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
import { z } from 'zod'
import type { Ref } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import { upperFirst } from 'scule'
import type { QueueData, Job } from '../../types'
import type { Form, FormSubmitEvent } from '#ui/types'
import {
  useRoute,
  navigateTo,
  useFetch,
  ref,
  useQueueSubscription,
  computed,
  useRouter,
  useTemplateRef,
  h,
  reactive,
} from '#imports'
import { UBadge, UProgress, UDropdownMenu, UButton } from '#components'

const route = useRoute()

const {
  data: queue,
  refresh,
} = await useFetch<QueueData>(`/api/_queue/${route.query?.name}`, {
  method: 'GET',
})

const table = useTemplateRef('table')

// Selected Rows
const selectedRows = ref([]) as Ref<Job[]>

function back() {
  navigateTo({
    query: {
      tab: 'queue',
    },
  })
}

function select(id: string) {
  const { page, ...query } = route.query
  navigateTo({
    query: {
      ...query,
      job: id,
    },
  })
}

const jobStates = ['active', 'completed', 'delayed', 'failed', 'paused', 'prioritized', 'waiting', 'waiting-children']
const filters = ref([])
// @ts-ignore
const page = ref(Number.parseInt(route.query?.page) || 1)
// @ts-ignore
const limit = ref(Number.parseInt(route.query?.limit) || 20)

const router = useRouter()

const updateJobStateFilter = () => {
  page.value = 1
  // set page to 1
  router.replace({
    query: {
      ...route.query,
      page: 1,
    },
  })
}

const {
  data,
  status,
  refresh: refreshJobs,
} = await useFetch(`/api/_queue/${route.query?.name}/job`, {
  query: {
    limit: limit,
    page: page,
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
        UDropdownMenu,
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
    updateJob(event.jobId, 'state', 'failed')
  },
  onWaiting: (event) => {
    console.log(event)
    refresh()
    updateJob(event.jobId, 'state', 'waiting')
  },
  onActive: (event) => {
    console.log(event)
    refresh()
    updateJob(event.jobId, 'state', 'active')
  },
  onAdded: (event) => {
    console.log(event)
    refresh()
    refreshJobs()
  },
  onProgress: (event) => {
    console.log(event)
    refresh()
    // Currently update job is not working because of shallowRef used by tanstack table -> check out new way for updating manually
    // updateJob(event.jobId, 'progress', event?.data || 0)
    refreshJobs()
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
  const resp = await $fetch<any>(`/api/_queue/${route.query?.name}/job`, {
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
</script>
