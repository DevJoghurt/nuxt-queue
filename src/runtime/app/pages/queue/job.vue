<template>
  <div>
    <UBreadcrumb
      divider="/"
      :items="[
        { label: 'Queue', to: componentRouter.makeHref('/queue') },
        { label: job?.queue || '', to: job?.queue ? componentRouter.makeHref('/queue/:name/jobs', { name: String(job?.queue) }) : undefined },
        { label: job?.id || '' },
      ]"
    />
    <section class="flex justify-between items-center py-4">
      <div>
        <h1 class="text-xl font-bold">
          Job - {{ job?.name || '' }}
        </h1>
        <p class="text-sm font-thin text-gray-500">
          Job details
        </p>
      </div>
      <DropdownMenu
        :items="[[
          {
            label: 'Re-create job',
            icon: 'i-heroicons-arrow-path-rounded-square',
            onSelect: reCreateJob,
          },
        ]]"
        :disabled="!job?.id"
      >
        <Button
          variant="outline"
          size="sm"
          label="Options"
          trailing-icon="i-heroicons-chevron-down-20-solid"
        />
      </DropdownMenu>
    </section>
    <div class="flex flex-col lg:flex-row py-8 space-y-4 lg:space-y-0 lg:space-x-4">
      <div class="w-full lg:w-2/3">
        <UCard class="w-full">
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-bold">
                Logs
              </h2>
              <div class="flex gap-2 items-center">
                <UInput
                  v-model="limitStr"
                  class="w-24"
                  placeholder="limit"
                />
                <Button
                  size="xs"
                  color="neutral"
                  variant="outline"
                  class="cursor-pointer"
                  @click="loadMore"
                >
                  More
                </Button>
                <Button
                  size="xs"
                  color="neutral"
                  variant="outline"
                  class="cursor-pointer"
                  @click="toggleTail"
                >
                  {{ open ? 'Stop tail' : 'Tail' }}
                </Button>
                <span
                  v-if="reconnecting"
                  class="text-xs text-amber-500"
                >Reconnecting…</span>
              </div>
            </div>
          </template>
          <TimelineList
            :items="logEvents"
            height-class="h-96"
          />
        </UCard>
      </div>
      <div class="w-full lg:w-1/3">
        <UTabs
          :items="tabItems"
          class="w-full"
        >
          <template #content="{ item }">
            <UCard>
              <template #header>
                <h2 class="text-lg font-bold">
                  {{ item.label }}
                </h2>
              </template>
              <div>
                <div
                  v-if="item.key === 'status'"
                  class="flex flex-col space-y-4"
                >
                  <div>
                    <p class="text-xs font-thin text-gray-500">
                      Progress
                    </p>
                    <div class="text-sm font-bold">
                      <Progress
                        v-model="progress"
                        indicator
                      />
                    </div>
                  </div>
                  <div>
                    <p class="text-xs font-thin text-gray-500">
                      Created on
                    </p>
                    <p class="text-sm font-bold">
                      {{ job?.timestamp ? new Date((job?.timestamp || 0)).toLocaleString() : 'not created' }}
                    </p>
                  </div>
                  <div>
                    <p class="text-xs font-thin text-gray-500">
                      Finished on
                    </p>
                    <p class="text-sm font-bold">
                      {{ job?.finishedOn ? new Date((job?.finishedOn || 0)).toLocaleString() : 'not finished' }}
                    </p>
                  </div>
                  <div>
                    <p class="text-xs font-thin text-gray-500">
                      Attempts started
                    </p>
                    <p class="text-sm font-bold">
                      {{ job?.attemptsStarted }}
                    </p>
                  </div>
                  <div>
                    <p class="text-xs font-thin text-gray-500">
                      Attempts made
                    </p>
                    <p class="text-sm font-bold">
                      {{ job?.attemptsMade }}
                    </p>
                  </div>
                  <div>
                    <p class="text-xs font-thin text-gray-500">
                      Delay
                    </p>
                    <p class="text-sm font-bold">
                      {{ job?.delay }}
                    </p>
                  </div>
                </div>
                <div
                  v-if="item.key === 'data'"
                  class="overflow-x-auto"
                >
                  <pre>{{ job?.data }}</pre>
                </div>
                <div
                  v-if="item.key === 'return'"
                  class="overflow-x-auto"
                >
                  <pre>{{ job?.returnvalue }}</pre>
                </div>
              </div>
            </UCard>
          </template>
        </UTabs>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { Ref } from '#imports'
import {
  useRoute,
  useFetch,
  ref,
  useQueueSubscription,
  onMounted,
  useComponentRouter,
} from '#imports'
import TimelineList from '../../components/TimelineList.vue'

const tabItems = [{
  key: 'status',
  label: 'Status',
}, {
  key: 'data',
  label: 'Data',
}, {
  key: 'return',
  label: 'Return Value',
}]

const route = useRoute()
const componentRouter = useComponentRouter()
const queueName = ref<string>((componentRouter?.route?.value?.params?.name as string) || (route.query?.name as string) || '')
const jobParam = ((componentRouter?.route?.value?.params?.id as string) || (route.query?.job as string) || '')

const {
  data: job,
  refresh,
} = await useFetch<any>(`/api/_queues/${queueName.value}/job/${jobParam}` as string, {
  method: 'GET',
})

// keep separate ref for subscription signature
const queueNameRef = ref(queueName.value) as Ref<string>

const progress = ref((job.value as any)?.progress || 0)
const jobId = ref((job.value as any)?.id || jobParam || null)

// Logs timeline state
const logEvents = ref<any[]>([])
const lastLogId = ref<string | undefined>(undefined)
const limitStr = ref<string>('100')

// TODO: Implement WebSocket-based log tailing
const open = ref(false)
const reconnecting = ref(false)

const loadMore = async () => {
  if (!queueName.value || !jobId.value) return
  const limit = Number(limitStr.value || '100')
  const url = `/api/_queues/${encodeURIComponent(queueName.value)}/job/${encodeURIComponent(String(jobId.value))}/logs?limit=${limit}${lastLogId.value ? `&fromId=${encodeURIComponent(lastLogId.value)}` : ''}`
  const res = await $fetch<{ items: any[], nextFromId?: string }>(url)
  const recs = res?.items || []
  if (recs.length) {
    logEvents.value.push(...recs)
    lastLogId.value = res?.nextFromId || recs[recs.length - 1].id
  }
}

const toggleTail = async () => {
  // TODO: Implement WebSocket-based log tailing
  console.warn('Log tailing not yet implemented with WebSocket')
  // if (open.value) return stopSSE()
  // if (!queueName.value || !jobId.value) return
  // const url = `/api/_queues/${encodeURIComponent(queueName.value)}/job/${encodeURIComponent(String(jobId.value))}/logs/tail`
  // startSSE(url, (msg) => {
  //   if (msg?.record) {
  //     logEvents.value.push(msg.record)
  //     lastLogId.value = msg.record.id
  //   }
  // }, { autoReconnect: true, maxRetries: 30, baseDelayMs: 500, maxDelayMs: 10000 })
}

onMounted(async () => {
  await loadMore()
})

useQueueSubscription(queueNameRef.value, {
  onCompleted: async (event) => {
    if (event.jobId === route.query?.job) {
      await refresh()
    }
  },
  onProgress: (event) => {
    if (event.jobId === route.query?.job) {
      progress.value = event.data
    }
  },
})

const reCreateJob = async () => {
  const created = await $fetch<{ id: string }>(`/api/_queues/${queueName.value}/job`, {
    method: 'POST',
    body: {
      name: job.value?.name,
      data: JSON.stringify(job.value?.data),
      options: (job.value as any)?.options,
    },
  })
  jobId.value = created.id
  progress.value = 0
  if (componentRouter?.pushTo) {
    await componentRouter.pushTo('/queue/:name/jobs/:id', { name: queueName.value, id: created.id })
  }
}
</script>
