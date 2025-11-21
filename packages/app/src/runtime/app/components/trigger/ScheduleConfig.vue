<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-clock"
          class="w-5 h-5 text-emerald-500"
        />
        <h2 class="text-lg font-semibold">
          Schedule Configuration
        </h2>
      </div>
    </template>

    <UForm
      :state="config"
      class="space-y-4"
    >
      <UFormField
        label="Cron Expression"
        name="cron"
      >
        <template #hint>
          <span class="text-xs text-gray-500">Standard cron format (e.g., "0 * * * *" for hourly)</span>
        </template>
        <UInput
          :model-value="config.cron"
          @update:model-value="$emit('update:cron', $event)"
          placeholder="0 * * * *"
          icon="i-lucide-calendar"
        />
      </UFormField>

      <UFormField
        label="Interval (seconds)"
        name="interval"
      >
        <template #hint>
          <span class="text-xs text-gray-500">Alternative to cron - run every N seconds</span>
        </template>
        <UInput
          :model-value="config.interval"
          @update:model-value="$emit('update:interval', $event ? Number($event) : undefined)"
          type="number"
          placeholder="3600"
          icon="i-lucide-timer"
        />
      </UFormField>

      <UFormField
        label="Timezone"
        name="timezone"
      >
        <template #hint>
          <span class="text-xs text-gray-500">IANA timezone (e.g., "America/New_York")</span>
        </template>
        <UInput
          :model-value="config.timezone"
          @update:model-value="$emit('update:timezone', $event)"
          placeholder="UTC"
          icon="i-lucide-globe"
        />
      </UFormField>

      <UFormField
        label="Enabled"
        name="enabled"
      >
        <ClientOnly>
          <UCheckbox
            :model-value="config.enabled"
            @update:model-value="$emit('update:enabled', $event)"
            label="Schedule is enabled"
          />
        </ClientOnly>
      </UFormField>
    </UForm>
  </UCard>
</template>

<script setup lang="ts">
defineProps<{
  config: {
    cron: string
    interval: number | undefined
    timezone: string
    enabled: boolean
  }
}>()

defineEmits<{
  'update:cron': [value: string]
  'update:interval': [value: number | undefined]
  'update:timezone': [value: string]
  'update:enabled': [value: boolean]
}>()
</script>
