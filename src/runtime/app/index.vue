<template>
  <div class="px-4 md:px-8 py-6">
    <div>
      <Queue v-if="tab === 'queue' && !name" />
      <QueueJobs v-if="tab === 'queue' && name && !job" />
      <QueueJob v-if="tab === 'queue' && name && job" />
      <QueueEvents v-if="tab === 'events'" />
      <QueueFlows v-if="tab === 'flows'" />
      <QueueDashboard v-if="tab === 'dashboard'" />
    </div>
  </div>
</template>

<script setup lang="ts">
import Queue from './queue/index.vue'
import QueueJobs from './queue/jobs.vue'
import QueueJob from './queue/job.vue'
import QueueDashboard from './dashboard/index.vue'
// Components registered globally by the module: QueueEvents, QueueFlows
import { useRoute, ref, reactive, watch } from '#imports'

const route = useRoute()

const tab = ref(route.query?.tab || 'queue')
const name = ref(route.query?.name || null)
const job = ref(route.query?.job || null)

const items = reactive([
  [
    { label: 'Queue', tab: 'queue', to: '?tab=queue', active: tab.value === 'queue' },
    { label: 'Events', tab: 'events', to: '?tab=events', active: tab.value === 'events' },
    { label: 'Flows', tab: 'flows', to: '?tab=flows', active: tab.value === 'flows' },
    { label: 'Dashboard', tab: 'dashboard', to: '?tab=dashboard', active: tab.value === 'dashboard' },
  ],
])

watch(() => route.query, (val) => {
  tab.value = val?.tab || 'queue'
  name.value = val?.name || null
  job.value = val?.job || null

  const first = items[0] || []
  for (const link of first) link.active = link.tab === tab.value
})
</script>
