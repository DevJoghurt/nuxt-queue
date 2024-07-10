<template>
    <div class="px-8 py-6">
        <section>
            <h1 class="text-xl font-bold">Worker</h1>
            <p class="text-sm font-thin text-gray-500">All registered worker</p>
        </section>
        <div>
            <div class="py-4">
                <UInput placeholder="Search" />
            </div>
            <div class="space-y-4">
                <QueueListItem
                    v-for="w of worker" 
                    :title="w.name"
                    :link="`?tab=worker&id=${w.id}`"
                    :dropdown="[
                        [{ 
                            label: 'New process', 
                            icon: 'i-heroicons-play',
                            click: async () => await startNewProcess(w.id)
                        }],
                        [{ 
                            label: 'Kill all process', 
                            icon: 'i-heroicons-x-circle',
                            click: async () => await killAllProcess(w.id)
                        }]
                    ]"
                >
                    <QueueStatCounter name="Processes" :count="w.processes" />
                </QueueListItem>
            </div>
        </div>
    </div>
</template>
<script setup lang="ts">


    const { 
        data: worker, 
        status, 
        error,
        refresh
    } = await useFetch('/api/_worker', {
            method: 'GET'
    })

    const startNewProcess = async (id: string) => {
        await fetch(`/api/_worker/${id}/process/start`, {
            method: 'POST'
        })
    }

    const killAllProcess = async (id: string) => {
        await fetch(`/api/_worker/${id}/process/delete`, {
            method: 'DELETE'
        })
    }

</script>