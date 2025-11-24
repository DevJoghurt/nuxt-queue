<template>
  <component :is="noCard ? 'div' : UCard">
    <template v-if="!noCard" #header>
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
      nested
      :name="name"
      :schema="schema"
      :class="noCard ? 'space-y-6' : 'space-y-4'"
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
          v-model="config.event"
          placeholder="user.created"
          icon="i-lucide-radio"
        />
      </UFormField>

      <UFormField
        label="Event Filter (JSON)"
        name="filter"
      >
        <template #hint>
          <span class="text-xs text-gray-500">Optional JSON filter to match specific event payloads</span>
        </template>
        <UTextarea
          v-model="config.filter"
          placeholder='{"status": "active"}'
          :rows="4"
        />
      </UFormField>
    </UForm>
  </component>
</template>

<script setup lang="ts">
import { UCard } from '#components'
import { z } from 'zod'

const { noCard = false, name = 'config' } = defineProps<{
  noCard?: boolean
  name?: string
}>()

const config = defineModel<{
  event: string
  filter: string
}>({ required: true })

const schema = z.object({
  event: z.string().min(1, 'Event name is required'),
  filter: z.string().optional(),
})
</script>
