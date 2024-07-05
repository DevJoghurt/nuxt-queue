<template>
    <div class="border rounded p-4 min-w-32">
        <div class="flex flex-col gap-1 text-center">
            <span class="text-sm text-gray-500">{{ type }}</span>
            <span class="text-lg font-semibold">{{ count }}</span>
        </div>
    </div>
</template>
<script setup lang="ts">
    defineProps({
        type: String,
        count: Number
    })
</script>