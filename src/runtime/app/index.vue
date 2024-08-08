<template>
  <div>
    <div>
      <UHorizontalNavigation
        :links="links"
        class="border-b border-gray-200 dark:border-gray-800 px-4"
      />
    </div>
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

const tab = ref(route.query?.tab || 'dashboard')
const name = ref(route.query?.name || null)
const job = ref(route.query?.job || null)

const links = reactive([
  [{
    label: 'Dashboard',
    tab: 'dashboard',
    to: route.path,
    active: tab.value === 'dashboard',

  }, {
    label: 'Queue',
    tab: 'queue',
    to: '?tab=queue',
    active: tab.value === 'queue',
  }],
])

watch(() => route.query, (val) => {
  tab.value = val?.tab || 'dashboard'
  name.value = val?.name || null
  job.value = val?.job || null

  for (const link of links[0]) {
    link.active = link.tab === tab.value
  }
})
</script>
