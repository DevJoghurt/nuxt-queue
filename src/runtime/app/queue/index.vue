<template>
  <div class="px-8 py-6">
    <section>
      <h1 class="text-xl font-bold">
        Queue
      </h1>
      <p class="text-sm font-thin text-gray-500">
        All available queues
      </p>
    </section>
    <div>
      <div class="py-4">
        <UInput placeholder="Search" />
      </div>
      <div class="space-y-4">
        <QueueListItem
          v-for="queue of queues"
          :key="queue.name"
          :title="queue.name"
          :origin="queue.origin"
          :link="`?tab=queue&name=${queue.name}`"
          :dropdown="[
            [{
              label: 'New process',
              icon: 'i-heroicons-play',
              click: async () => await startNewProcess(queue.name),
            }],
            [{
              label: 'Kill all process',
              icon: 'i-heroicons-x-circle',
              click: async () => await killAllProcess(queue.name),
            }],
          ]"
        >
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
          <QueueStatCounter
            name="Worker"
            color="cyan"
            :count="queue?.worker"
          />
        </QueueListItem>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { QueueData } from '../../types'
import { useFetch, onMounted, onBeforeUnmount, ref } from '#imports'

const intval = ref<ReturnType<typeof setInterval> | null>(null)

const {
  data: queues,
  refresh,
} = await useFetch<QueueData[]>('/api/_queue', {
  method: 'GET',
})

const startNewProcess = async (name: string) => {
  await fetch(`/api/_queue/${name}/worker/process`, {
    method: 'POST',
  })
}

const killAllProcess = async (name: string) => {
  await fetch(`/api/_queue/${name}/worker/process`, {
    method: 'DELETE',
  })
}

onMounted(() => {
  intval.value = setInterval(() => {
    console.log('Refreshing queue data')
    refresh()
  }, 2000)
})

onBeforeUnmount(() => {
  if (intval.value) {
    clearInterval(intval.value)
  }
})
</script>
