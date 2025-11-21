<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-info"
          class="w-5 h-5 text-blue-500"
        />
        <h2 class="text-lg font-semibold">
          Basic Information
        </h2>
      </div>
    </template>

    <UForm
      :state="formState"
      class="space-y-4"
    >
      <UFormField
        label="Trigger Name"
        name="name"
        required
      >
        <template #hint>
          <span class="text-xs text-gray-500">Cannot be changed after creation</span>
        </template>
        <UInput
          :model-value="formState.name"
          placeholder="my-trigger"
          disabled
          icon="i-lucide-tag"
        />
      </UFormField>

      <UFormField
        label="Display Name"
        name="displayName"
        required
      >
        <template #hint>
          <span class="text-xs text-gray-500">Human-readable name shown in the UI</span>
        </template>
        <UInput
          v-model="formState.displayName"
          placeholder="My Trigger"
          icon="i-lucide-type"
        />
      </UFormField>

      <UFormField
        label="Description"
        name="description"
      >
        <template #hint>
          <span class="text-xs text-gray-500">Optional description of what this trigger does</span>
        </template>
        <UTextarea
          v-model="formState.description"
          placeholder="Describe what this trigger does..."
          :rows="3"
        />
      </UFormField>

      <UFormField
        label="Trigger Type"
        name="type"
      >
        <template #hint>
          <span class="text-xs text-gray-500">Cannot be changed after creation</span>
        </template>
        <div class="flex items-center gap-2">
          <UIcon
            :name="getTriggerIcon(formState.type)"
            class="w-5 h-5"
            :class="getTriggerIconColor(formState.type)"
          />
          <UBadge
            :label="formState.type"
            :color="getTriggerTypeColor(formState.type)"
            variant="subtle"
            size="md"
          />
        </div>
      </UFormField>

      <UFormField
        label="Scope"
        name="scope"
      >
        <template #hint>
          <span class="text-xs text-gray-500">Cannot be changed after creation</span>
        </template>
        <UBadge
          :label="formState.scope"
          color="neutral"
          variant="subtle"
          size="md"
        />
      </UFormField>
    </UForm>
  </UCard>
</template>

<script setup lang="ts">
const props = defineProps<{
  formState: {
    name: string
    displayName: string
    description: string
    type: 'event' | 'webhook' | 'schedule' | 'manual'
    scope: 'flow' | 'run'
  }
}>()

const getTriggerIcon = (type: string) => {
  switch (type) {
    case 'event': return 'i-lucide-radio'
    case 'webhook': return 'i-lucide-webhook'
    case 'schedule': return 'i-lucide-clock'
    case 'manual': return 'i-lucide-hand'
    default: return 'i-lucide-zap'
  }
}

const getTriggerIconColor = (type: string) => {
  switch (type) {
    case 'event': return 'text-blue-500'
    case 'webhook': return 'text-purple-500'
    case 'schedule': return 'text-emerald-500'
    case 'manual': return 'text-amber-500'
    default: return 'text-gray-500'
  }
}

const getTriggerTypeColor = (type: string): 'primary' | 'success' | 'warning' | 'error' | 'neutral' => {
  switch (type) {
    case 'event': return 'primary'
    case 'webhook': return 'success'
    case 'schedule': return 'warning'
    case 'manual': return 'neutral'
    default: return 'neutral'
  }
}
</script>
