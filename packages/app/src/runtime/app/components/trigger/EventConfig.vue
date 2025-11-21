<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-radio"
          class="w-5 h-5 text-blue-500"
        />
        <h2 class="text-lg font-semibold">
          Event Configuration
        </h2>
      </div>
    </template>

    <UForm
      :state="config"
      class="space-y-4"
    >
      <UFormField
        label="Event Name"
        name="event"
        required
      >
        <template #hint>
          <span class="text-xs text-gray-500">The event type to listen for</span>
        </template>
        <UInput
          :model-value="config.event"
          @update:model-value="$emit('update:event', $event)"
          placeholder="user.created"
          icon="i-lucide-radio"
        />
      </UFormField>

      <UFormField
        label="Event Filter (JSON)"
        name="filter"
      >
        <template #hint>
          <span class="text-xs text-gray-500">Optional JSON filter for event data</span>
        </template>
        <UTextarea
          :model-value="config.filter"
          @update:model-value="$emit('update:filter', $event)"
          placeholder="{&quot;status&quot;: &quot;active&quot;}"
          :rows="4"
        />
      </UFormField>
    </UForm>
  </UCard>
</template>

<script setup lang="ts">
defineProps<{
  config: {
    event: string
    filter: string
  }
}>()

defineEmits<{
  'update:event': [value: string]
  'update:filter': [value: string]
}>()
</script>
