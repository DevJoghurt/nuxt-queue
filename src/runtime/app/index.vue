<template>
    <div>
        <div>
            <UHorizontalNavigation :links="links" class="border-b border-gray-200 dark:border-gray-800 px-4" />
        </div>
        <div>
            <Queue v-if="tab === 'queue' && !id" />
            <QueueJobs v-if="tab === 'queue' && id && !job" />
            <QueueJob v-if="tab === 'queue' && id && job" />
            <Process v-if="tab === 'worker'" />
        </div>
    </div>
</template>
<script setup lang="ts">
    import { useRoute } from '#imports'
    import Queue from './queue/index.vue'
    import QueueJobs from './queue/jobs.vue'
    import QueueJob from './queue/job.vue'
    import Process from './worker/index.vue'

    const route = useRoute()

    const tab = ref(route.query?.tab || 'dashboard')
    const id = ref(route.query?.id || null)
    const job = ref(route.query?.job || null)

    const links = reactive([
        [{
            label: 'Dashboard',
            tab: 'dashboard',
            to: route.path,
            active: tab.value === 'dashboard'
            
        }, {
            label: 'Queue',
            tab: 'queue',
            to: '?tab=queue',
            active: tab.value === 'queue'
        }, {
            label: 'Worker',
            tab: 'worker',
            to: '?tab=worker',
            active: tab.value === 'worker'
        }]
    ])

    watch(() => route.query, (val) => {
        tab.value = val?.tab || 'dashboard'
        id.value = val?.id || null
        
        for(const link of links[0]) {
            link.active = link.tab === tab.value
        }
    })
</script>