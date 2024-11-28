<template>
  <div class="px-8 py-6">
    <UBreadcrumb
      divider="/"
      :items="[
        {
          label: 'Queue',
          to: '?tab=queue',
        }, {
          label: job.queue,
          to: `?tab=queue&name=${job.queue}`,
        }, {
          label: job.id,
        },
      ]"
    />
    <section class="flex justify-between items-center py-4">
      <div>
        <h1 class="text-xl font-bold">
          Job - {{ job.name }}
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
        <UCard
          class="w-full"
          :ui=" {
            root: 'bg-zinc-800 text-white',
          }"
        >
          <template #header>
            <h2 class="text-lg font-bold">
              Logs
            </h2>
          </template>
          <div class="h-96 overflow-y-auto">
            <pre
              v-for="log of job?.logs"
              :key="log"
            >{{ log }}</pre>
          </div>
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
                  <pre>{{ job.data }}</pre>
                </div>
                <div
                  v-if="item.key === 'return'"
                  class="overflow-x-auto"
                >
                  <pre>{{ job.returnvalue }}</pre>
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
  navigateTo,
  useFetch,
  ref,
  useQueueSubscription,
} from '#imports'

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
} = await useFetch<QueueData>(`/api/_queue/${route.query?.name}/job/${route.query?.job}`, {
  method: 'GET',
})

const queueName = ref(route.query?.name) as Ref<string>

const progress = ref(job.value.progress || 0)
const jobId = ref(job.value.id || null)

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
  job.value = await $fetch<QueueData>(`/api/_queue/${route.query?.name}/job`, {
    method: 'POST',
    body: {
      name: job.value.name,
      data: JSON.stringify(job.value.data),
      options: job.value.options,
    },
  })
  jobId.value = job.value.id
  progress.value = 0
  await navigateTo({
    query: {
      tab: 'queue',
      name: route.query?.name,
      job: job.value.id,
    },
  })
}
</script>
