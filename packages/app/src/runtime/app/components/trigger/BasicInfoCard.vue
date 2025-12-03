<template>
  <component :is="noCard ? 'div' : UCard">
    <template
      v-if="!noCard"
      #header
    >
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
      nested
      :schema="schema"
      :class="noCard ? 'space-y-6' : 'space-y-4'"
    >
      <UFormField
        name="name"
        label="Trigger Name"
        required
      >
        <template #hint>
          <span class="text-xs text-gray-500">{{ isEdit ? 'Cannot be changed after creation' : 'Use lowercase letters, numbers, and hyphens only' }}</span>
        </template>
        <UInput
          v-model="formState.name"
          :placeholder="formState.name ? 'my-trigger' : 'e.g., user-signup-trigger'"
          :disabled="isEdit"
          icon="i-lucide-tag"
          class="w-full"
        />
      </UFormField>

      <UFormField
        name="displayName"
        label="Display Name"
        required
      >
        <template #hint>
          <span class="text-xs text-gray-500">Human-readable name shown in the UI</span>
        </template>
        <UInput
          v-model="formState.displayName"
          :placeholder="formState.displayName || 'e.g., User Signup Trigger'"
          icon="i-lucide-type"
          class="w-full"
        />
      </UFormField>

      <UFormField
        name="description"
        label="Description"
      >
        <template #hint>
          <span class="text-xs text-gray-500">Optional description of what this trigger does</span>
        </template>
        <UTextarea
          v-model="formState.description"
          placeholder="Describe what this trigger does..."
          :rows="3"
          class="w-full"
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
  </component>
</template>

<script setup lang="ts">
import { UCard } from '#components'
import { z } from 'zod'

const { noCard = false, isEdit = false } = defineProps<{
  noCard?: boolean
  isEdit?: boolean
}>()

const formState = defineModel<{
  name: string
  displayName: string
  description: string
  type: 'event' | 'webhook' | 'schedule' | 'manual'
  scope: 'flow' | 'run'
}>({ required: true })

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

const schema = z.object({
  name: z.string().min(1, 'Name is required').regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers, and hyphens only'),
  displayName: z.string().min(1, 'Display name is required'),
  description: z.string(),
  type: z.enum(['event', 'webhook', 'schedule', 'manual']),
  scope: z.enum(['flow', 'run']),
})
</script>
