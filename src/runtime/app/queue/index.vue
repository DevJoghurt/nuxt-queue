<template>
  <div>
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
        <UInput
          class="w-full md:w-72"
          placeholder="Search"
        />
      </div>
      <UCard class="mb-4">
        <template #header>
          <div class="flex items-center justify-between">
            <div class="font-semibold">
              Metrics
            </div>
            <UButton
              size="xs"
              color="neutral"
              variant="outline"
              class="cursor-pointer"
              @click="refreshMetrics()"
            >
              Refresh
            </UButton>
          </div>
        </template>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div
            v-for="q in queues"
            :key="q.name"
            class="p-3 rounded bg-gray-100/10"
          >
            <div class="text-sm font-semibold">
              {{ q.name }}
            </div>
            <div class="text-xs text-gray-500">
              {{ metrics?.[q.name]?.paused ? 'Paused' : 'Running' }}
            </div>
            <div class="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div>
                Active: <span class="font-mono">{{ metrics?.[q.name]?.counts?.active || 0 }}</span>
              </div>
              <div>
                Waiting: <span class="font-mono">{{ metrics?.[q.name]?.counts?.waiting || 0 }}</span>
              </div>
              <div>
                Completed: <span class="font-mono">{{ metrics?.[q.name]?.counts?.completed || 0 }}</span>
              </div>
              <div>
                Failed: <span class="font-mono">{{ metrics?.[q.name]?.counts?.failed || 0 }}</span>
              </div>
            </div>
          </div>
        </div>
      </UCard>
      <div class="space-y-4">
        <QueueListItem
          v-for="queue of queues"
          :key="queue.name"
          :title="queue.name"
          :origin="queue.origin"
          :link="`?tab=queue&name=${queue.name}`"
          :dropdown="[
            [{
              label: (metrics?.[queue.name]?.paused ? 'Resume queue' : 'Pause queue'),
              icon: (metrics?.[queue.name]?.paused ? 'i-heroicons-play' : 'i-heroicons-pause'),
              onSelect: async () => await togglePause(queue.name, !!metrics?.[queue.name]?.paused),
            }],
          ]"
        >
          <QueueStatCounter
            name="Active"
            color="yellow"
            :count="metrics?.[queue.name]?.counts?.active || 0"
          />
          <QueueStatCounter
            name="Waiting"
            color="neutral"
            :count="metrics?.[queue.name]?.counts?.waiting || 0"
          />
          <QueueStatCounter
            name="Completed"
            color="green"
            :count="metrics?.[queue.name]?.counts?.completed || 0"
          />
          <QueueStatCounter
            name="Failed"
            color="red"
            :count="metrics?.[queue.name]?.counts?.failed || 0"
          />
        </QueueListItem>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useFetch, onMounted, onBeforeUnmount, ref } from '#imports'

const intval = ref<ReturnType<typeof setInterval> | null>(null)

const {
  data: queues,
  refresh,
} = await useFetch('/api/_queue', {
  method: 'GET',
})

// Metrics map: { [queueName]: { counts?: {..}, paused?: boolean } }
const { data: metrics, refresh: refreshMetrics } = await useFetch('/api/_queue/metrics', { method: 'GET' })

const togglePause = async (name: string, currentlyPaused: boolean) => {
  const action = currentlyPaused ? 'resume' : 'pause'
  await $fetch(`/api/_queue/${name}/${action}`, { method: 'POST' })
  await refreshMetrics()
}

onMounted(() => {
  intval.value = setInterval(() => {
    console.log('Refreshing queue data')
    refresh()
    refreshMetrics()
  }, 2000)
})

onBeforeUnmount(() => {
  if (intval.value) {
    clearInterval(intval.value)
  }
})
</script>
