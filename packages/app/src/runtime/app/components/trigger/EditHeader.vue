<template>
  <div class="border-b border-gray-200 dark:border-gray-800 px-6 py-4 bg-white dark:bg-gray-900 shrink-0">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <UButton
          icon="i-lucide-arrow-left"
          size="sm"
          color="neutral"
          variant="ghost"
          @click="$emit('back')"
        />
        <div>
          <h1 class="text-xl font-semibold flex items-center gap-2">
            <UIcon
              name="i-lucide-pencil"
              class="w-5 h-5 text-blue-500"
            />
            <span>Edit Trigger</span>
          </h1>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Modify trigger configuration and subscriptions
          </p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          @click="$emit('cancel')"
        >
          Cancel
        </UButton>
        <UButton
          color="primary"
          :loading="isSaving"
          :disabled="!hasChanges"
          @click="$emit('save')"
        >
          <template #leading>
            <UIcon name="i-lucide-save" />
          </template>
          Save Changes
        </UButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  isSaving: boolean
  hasChanges: boolean
}>()

defineEmits<{
  back: []
  cancel: []
  save: []
}>()
</script>
