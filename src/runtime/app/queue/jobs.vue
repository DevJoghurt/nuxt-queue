<template>
    <div class="px-8 py-6">
        <section class="flex justify-between py-4">
            <div>
                <h1 class="text-xl font-bold">Queue - {{ queueId }}</h1>
                <p class="text-sm font-thin text-gray-500">Overview of all Jobs</p>
            </div>
            <div>
                <div class="flex flex-row gap-4 justify-end">
                    <QueueStatCounter type="Active" :count="queue?.jobs.active" />
                    <QueueStatCounter type="Waiting" :count="queue?.jobs.waiting" />
                    <QueueStatCounter type="Completed" :count="queue?.jobs.completed" />
                    <QueueStatCounter type="Failed" :count="queue?.jobs.failed" />
                </div>
            </div>
        </section>
        <section>
            <UCard>
                <UTable :columns="columns" :rows="jobs" :sort="{
                    column: 'timestamp',
                    direction: 'desc'
                }">
                    <template #progress-data="{ row }">
                        <UProgress :value="row.progress" indicator />
                    </template>
                </UTable>
                <template #footer>
                    <div class="flex justify-start px-3 py-3.5">
                        <UPagination v-model="page" :page-count="pageCount" :total="jobs.length" />
                    </div>
                </template>
            </UCard>
        </section>
    </div>
</template>
<script setup lang="ts">
    import { useRoute, useFetch, ref, useQueueSubscription } from '#imports'
    import type { Ref } from 'vue'
    import type { QueueData, Jobs } from '../../types'

    const route = useRoute()

    const { 
        data: queue, 
        status, 
        error,
        refresh
    } = await useFetch<QueueData>(`/api/_queue/${route.query?.id}`, {
            method: 'GET'
    })

    
    const { data: jobs, refresh: refreshJobs } = await useFetch(`/api/_queue/${route.query?.id}/job`,{
        transform: (data: Jobs) => {
            return data.map((job) => ({
                id: job.id,
                name: job.name,
                progress: job.progress,
                timestamp: job.timestamp,
                state: job.state,
                finishedOn: job.finishedOn
            }))
        }
    })

    const page = ref(1)
    const pageCount = 5

    const columns = [{
        key: 'timestamp',
        label: 'Created',
        sortable: true,
        direction: 'desc' as const
    },{
        key: 'id',
        label: 'ID',
        sortable: true,

    }, {
        key: 'name',
        label: 'Name',
        sortable: true
    },{
        key: 'state',
        label: 'State'
    }, {
        key: 'progress',
        label: 'Progress'
    }, {
        key: 'finishedOn',
        label: 'Finished'
    }]

    const queueId = ref(route.query?.id) as Ref<string>

    useQueueSubscription(queueId.value, {
        onCompleted: (event) => {
            console.log(event)
            refresh()
            refreshJobs()
        },
        onFailed: (event) => {
            console.log(event)
            refresh()
        },
        onWaiting: (event) => {
            console.log(event)
            refresh()
        },
        onActive: (event) => {
            console.log(event)
            refresh()
        },
        onAdded: (event) => {
            console.log(event)
            refresh()
            refreshJobs()
        },
        onProgress: (event) => {
            console.log(event)
            jobs.value = jobs.value?.map((job) =>{
                if(event.id === job.id){
                    job.progress = event.progress
                }
                return job
            }) || null
        }
    })

</script>