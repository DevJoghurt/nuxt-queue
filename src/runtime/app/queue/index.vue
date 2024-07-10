<template>
    <div class="px-8 py-6">
        <section>
            <h1 class="text-xl font-bold">Queue</h1>
            <p class="text-sm font-thin text-gray-500">All available queues</p>
        </section>
        <div>
            <div class="py-4">
                <UInput placeholder="Search" />
            </div>
            <div class="space-y-4">
                <QueueListItem
                    v-for="queue of queues" 
                    :title="queue.id"
                    :link="`?tab=queue&id=${queue.id}`"
                >
                    <QueueStatCounter name="Active" color="orange" :count="queue?.jobs.active" />
                    <QueueStatCounter name="Waiting" color="yellow" :count="queue?.jobs.waiting" />
                    <QueueStatCounter name="Completed" color="green" :count="queue?.jobs.completed" />
                    <QueueStatCounter name="Failed" color="red" :count="queue?.jobs.failed" />
                </QueueListItem>
            </div>
        </div>
    </div>
</template>
<script setup lang="ts">
    import { useFetch, onMounted, onBeforeUnmount } from '#imports'
    import type { QueueData } from '../../types'

    const intval = ref<ReturnType<typeof setInterval> | null>(null)

    const { 
        data: queues, 
        status, 
        error,
        refresh
    } = await useFetch<QueueData[]>('/api/_queue', {
            method: 'GET'
    })

    onMounted(() => {
        intval.value = setInterval(() => {
            console.log('Refreshing queue data')
            refresh()
        }, 2000)
    })

    onBeforeUnmount(() => {
        if(intval.value) {
            clearInterval(intval.value)
        }
    })

</script>