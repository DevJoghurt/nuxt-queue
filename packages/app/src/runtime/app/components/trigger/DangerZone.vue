<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-alert-triangle"
          class="w-5 h-5 text-red-500"
        />
        <h2 class="text-lg font-semibold text-red-600 dark:text-red-400">
          Danger Zone
        </h2>
      </div>
    </template>

    <div class="space-y-4">
      <div class="flex items-start justify-between p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg">
        <div>
          <h3 class="font-semibold text-red-900 dark:text-red-100">
            Delete this trigger
          </h3>
          <p class="text-sm text-red-700 dark:text-red-300 mt-1">
            Once deleted, this trigger cannot be recovered. All subscriptions will be removed.
          </p>
        </div>
        <UButton
          color="error"
          variant="outline"
          :loading="isDeleting"
          @click="$emit('delete')"
        >
          <template #leading>
            <UIcon name="i-lucide-trash-2" />
          </template>
          Delete
        </UButton>
      </div>
    </div>
  </UCard>
</template>

<script setup lang="ts">
defineProps<{
  isDeleting: boolean
}>()

defineEmits<{
  delete: []
}>()
</script>
