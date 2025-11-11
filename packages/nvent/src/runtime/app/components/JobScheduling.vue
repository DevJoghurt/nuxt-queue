<template>
  <div class="space-y-4">
    <div class="flex justify-end">
      <Button
        icon="i-heroicons-clock"
        color="neutral"
        variant="outline"
        @click="jobSchedulerEditor = !jobSchedulerEditor"
      >
        Job Scheduler
      </Button>
    </div>
    <UForm
      :schema="schema"
      :state="state"
      @submit="onSubmit"
    >
      <UCard
        v-if="jobSchedulerEditor"
        :ui="{
          body: 'space-y-6',
        }"
      >
        <UFormField
          label="Name"
          name="name"
        >
          <UInput
            v-model="state.name"
            placeholder="Name"
            class="w-full"
          />
        </UFormField>
        <UTabs
          v-model="state.scheduleType"
          :items="scheduleInputTypes"
          size="xs"
          default-value="every"
          variant="pill"
          color="neutral"
          :ui="{
            list: 'w-28 self-start',
            content: 'w-full',
          }"
        >
          <template #content="{ item }">
            <UFormField name="scheduleValue">
              <UInput
                v-if="item.value === 'every'"
                v-model="state.scheduleValue"
                class="w-full"
                type="number"
              />
              <UInput
                v-if="item.value === 'cron'"
                v-model="state.scheduleValue"
                class="w-full"
                type="string"
              />
            </UFormField>
          </template>
        </UTabs>
        <div>
          <div class="text-sm font-bold mb-2">
            Job
          </div>
          <div class="flex flex-col space-y-2 p-2 rounded-sm ring-1 ring-gray-200 dark:ring-gray-800 shadow">
            <UFormField
              label="Name"
              name="jobName"
            >
              <UInput
                v-model="state.jobName"
                placeholder="Job Name"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Data"
              name="jobData"
            >
              <JsonEditorVue
                v-model="state.jobData"
                :main-menu-bar="false"
                mode="text"
              />
            </UFormField>
          </div>
        </div>
        <template #footer>
          <div class="flex justify-end">
            <Button
              type="submit"
              color="neutral"
              variant="outline"
              class="cursor-pointer"
            >
              Create
            </Button>
          </div>
        </template>
      </UCard>
    </UForm>
    <div>
      <div
        v-if="scheduler && scheduler.length > 0"
        class="space-y-4"
      >
        <div
          v-for="item of scheduler"
          :key="item.key"
          class="flex flex-col rounded-sm ring-1 ring-gray-200 dark:ring-gray-800 shadow p-4"
        >
          <div class="flex justify-end">
            <Button
              icon="i-heroicons-x-circle"
              color="error"
              variant="outline"
              class="cursor-pointer"
              @click="deleteScheduledJob(item.key)"
            />
          </div>
          <div>
            <span class="text-sm font-bold">Name:</span> {{ item.key }}
          </div>
          <div>
            <span class="text-sm font-bold">Next schedule:</span> {{
              new Date(item.next).toLocaleString('de', {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false,
              })
            }}
          </div>
        </div>
      </div>
      <div v-else>
        <UAlert
          color="info"
          title="No scheduled jobs"
          variant="subtle"
          icon="i-heroicons-information-circle"
          class="flex items-center space-x-2"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { z } from 'zod'
import { ref, useFetch } from '#imports'
import type { FormSubmitEvent } from '#ui/types'

const props = defineProps<{
  queue: string
}>()

const jobSchedulerEditor = ref<boolean>(false)

const scheduleInputTypes = [
  { label: 'Every', value: 'every' },
  { label: 'Cron', value: 'cron' },
]

const {
  data: scheduler,
  refresh,
} = await useFetch(`/api/_queue/${props.queue}/job/scheduler`, {
  method: 'GET',
})

const state = ref({
  name: undefined,
  scheduleType: 'every',
  scheduleValue: undefined,
  jobName: undefined,
  jobData: undefined,
})

const schema = z.object({
  name: z.string().regex(/^\S*$/gm, 'No spaces allowed'),
  scheduleType: z.enum(['every', 'cron']),
  scheduleValue: z.any(),
  jobName: z.string().regex(/^\S*$/gm, 'No spaces allowed'),
  jobData: z.string().default('{}'),
})

type Schema = z.output<typeof schema>

async function onSubmit(event: FormSubmitEvent<Schema>) {
  await $fetch<any>(`/api/_queue/${props.queue}/job/scheduler`, {
    method: 'POST',
    body: {
      name: event.data.name,
      scheduleType: event.data.scheduleType,
      scheduleValue: event.data.scheduleValue,
      jobName: event.data.jobName,
      jobData: JSON.stringify(event.data.jobData),
    },
  })
  refresh()
}

const deleteScheduledJob = async (id: string) => {
  await $fetch<any>(`/api/_queue/${props.queue}/job/scheduler/${id}`, {
    method: 'DELETE',
  })
  refresh()
}
</script>
