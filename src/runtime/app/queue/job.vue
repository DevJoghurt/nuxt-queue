<template>
  <div>
    <UBreadcrumb
      divider="/"
      :items="[
        {
          label: 'Queue',
          to: '?tab=queue',
        }, {
          label: job?.queue || '',
          to: `?tab=queue&name=${job?.queue || ''}`,
        }, {
          label: job?.id || '',
        },
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
      <UDropdownMenu
        :items="[[
          {
            label: 'Re-create job',
            icon: 'i-heroicons-arrow-path-rounded-square',
            onSelect: reCreateJob,
          },
        ]]"
        :disabled="!job?.id"
      >
        <UButton
          variant="outline"
          size="sm"
          label="Options"
          trailing-icon="i-heroicons-chevron-down-20-solid"
        />
      </UDropdownMenu>
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
                <UButton
                  size="xs"
                  color="neutral"
                  variant="outline"
                  class="cursor-pointer"
                  @click="loadMore"
                >
                  More
                </UButton>
                <UButton
                  size="xs"
                  color="neutral"
                  variant="outline"
                  class="cursor-pointer"
                  @click="toggleTail"
                >
                  {{ open ? 'Stop tail' : 'Tail' }}
                </UButton>
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
                      <UProgress
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
import type { Job } from '../../types'
import {
  useRoute,
  navigateTo,
  useFetch,
  ref,
  useQueueSubscription,
  onMounted,
} from '#imports'
import useEventSSE from '../../composables/useEventSSE'
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

const {
  data: job,
  refresh,
} = await useFetch<Job & { queue: string }>(`/api/_queue/${route.query?.name}/job/${route.query?.job}`, {
  method: 'GET',
})

const queueName = ref(route.query?.name) as Ref<string>

const progress = ref((job.value as any)?.progress || 0)
const jobId = ref((job.value as any)?.id || null)

// Logs timeline state
const logEvents = ref<any[]>([])
const lastLogId = ref<string | undefined>(undefined)
const limitStr = ref<string>('100')
const { start: startSSE, stop: stopSSE, open, reconnecting } = useEventSSE()

const loadMore = async () => {
  if (!queueName.value || !jobId.value) return
  const limit = Number(limitStr.value || '100')
  const url = `/api/_queue/${encodeURIComponent(queueName.value)}/job/${encodeURIComponent(String(jobId.value))}/logs?limit=${limit}${lastLogId.value ? `&fromId=${encodeURIComponent(lastLogId.value)}` : ''}`
  const recs = await $fetch<any[]>(url)
  if (recs && recs.length) {
    logEvents.value.push(...recs)
    lastLogId.value = recs[recs.length - 1].id
  }
}

const toggleTail = async () => {
  if (open.value) return stopSSE()
  if (!queueName.value || !jobId.value) return
  const url = `/api/_queue/${encodeURIComponent(queueName.value)}/job/${encodeURIComponent(String(jobId.value))}/logs/tail`
  startSSE(url, (msg) => {
    if (msg?.record) {
      logEvents.value.push(msg.record)
      lastLogId.value = msg.record.id
    }
  }, { autoReconnect: true, maxRetries: 30, baseDelayMs: 500, maxDelayMs: 10000 })
}

onMounted(async () => {
  await loadMore()
})

useQueueSubscription(queueName.value, {
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
  const created = await $fetch<{ id: string }>(`/api/_queue/${route.query?.name}/job`, {
    method: 'POST',
    body: {
      name: job.value?.name,
      data: JSON.stringify(job.value?.data),
      options: (job.value as any)?.options,
    },
  })
  jobId.value = created.id
  progress.value = 0
  await navigateTo({
    query: {
      tab: 'queue',
      name: route.query?.name,
      job: created.id,
    },
  })
}
</script>
