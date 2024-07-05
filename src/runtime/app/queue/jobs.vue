<template>
    <div class="px-8 py-6">
        <section class="flex justify-between">
            <div>
                <h1 class="text-xl font-bold">Queue - {{ queueId }}</h1>
                <p class="text-sm font-thin text-gray-500">Overview of all Jobs</p>
            </div>
            <div>
                <div class="flex flex-row gap-4 justify-end">
                    <QueueJobCounter type="Active" :count="queue?.jobs.active" />
                    <QueueJobCounter type="Waiting" :count="queue?.jobs.waiting" />
                    <QueueJobCounter type="Completed" :count="queue?.jobs.completed" />
                    <QueueJobCounter type="Failed" :count="queue?.jobs.failed" />
                </div>
            </div>
        </section>
    </div>
</template>
<script setup lang="ts">
    import { useRoute } from '#imports'
    import type { QueueData } from '../../types'

    const route = useRoute()

    const intval = ref<ReturnType<typeof setInterval> | null>(null)

    const { 
        data: queue, 
        status, 
        error,
        refresh
    } = await useFetch<QueueData>(`/api/_queue/${route.query?.id}`, {
            method: 'GET'
    })

    const queueId = ref(route.query?.id) as Ref<string>

    useQueueSubscription(queueId.value, {
        onCompleted: (event) => {
            console.log(event)
        },
        onFailed: (event) => {
            console.log(event)
        },
        onWaiting: (event) => {
            console.log(event)
        },
        onActive: (event) => {
            console.log(event)
        }
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