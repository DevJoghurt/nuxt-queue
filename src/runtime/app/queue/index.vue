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
                <div 
                    v-for="queue of queues" 
                    class="rounded-lg divide-y divide-gray-200 dark:divide-gray-800 ring-1 ring-gray-200 dark:ring-gray-800 shadow bg-white dark:bg-gray-900">
                    <div class="px-4 py-5 sm:p-6">
                        <div class="flex flex-row">
                            <div class="flex-none space-y-2">
                                <ULink :to="`?tab=queue&id=${queue.id}`" class="inline-flex items-center gap-1">
                                    <span class="text-lg font-semibold">{{ queue.id }}</span>
                                    <UIcon name="i-heroicons-arrow-up-right" class="w-5 h-5 text-primary-500" />
                                </ULink>
                                <div class="flex flex-wrap items-center gap-2">
                                    <div class="inline-flex gap-1 items-center">
                                        <UIcon name="i-heroicons-check-circle" class="w-4 h-4 text-green-500" />
                                        <span class="text-sm">Active</span>
                                    </div>
                                </div>
                            </div>
                            <div class="grow pr-12">
                                <div class="flex flex-row gap-4 justify-end">
                                    <QueueJobCounter type="Active" :count="queue?.jobs.active" />
                                    <QueueJobCounter type="Waiting" :count="queue?.jobs.waiting" />
                                    <QueueJobCounter type="Completed" :count="queue?.jobs.completed" />
                                    <QueueJobCounter type="Failed" :count="queue?.jobs.failed" />
                                </div>
                            </div>
                            <div class="flex-none">
                                <div class="flex gap-2 items-center">
                                    <div data-headlessui-state="" class="relative inline-flex text-left rtl:text-right">
                                        <UButton icon="i-heroicons-ellipsis-vertical" color="gray" variant="outline"  />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
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