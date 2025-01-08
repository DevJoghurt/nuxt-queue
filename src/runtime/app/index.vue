<template>
  <div class="px-4 md:px-8 py-6">
    <div>
      <Queue v-if="tab === 'queue' && !name" />
      <QueueJobs v-if="tab === 'queue' && name && !job" />
      <QueueJob v-if="tab === 'queue' && name && job" />
    </div>
  </div>
</template>

<script setup lang="ts">
import Queue from './queue/index.vue'
import QueueJobs from './queue/jobs.vue'
import QueueJob from './queue/job.vue'
import { useRoute, ref, reactive, watch } from '#imports'

const route = useRoute()

const tab = ref(route.query?.tab || 'queue')
const name = ref(route.query?.name || null)
const job = ref(route.query?.job || null)

const items = reactive([
  [{
    label: 'Queue',
    tab: 'queue',
    to: '?tab=queue',
    active: tab.value === 'queue',
  }],
])

watch(() => route.query, (val) => {
  tab.value = val?.tab || 'queue'
  name.value = val?.name || null
  job.value = val?.job || null

  for (const link of items[0]) {
    link.active = link.tab === tab.value
  }
})
</script>
