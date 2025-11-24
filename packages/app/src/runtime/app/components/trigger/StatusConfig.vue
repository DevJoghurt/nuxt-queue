<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-power"
          class="w-5 h-5"
        />
        <h3 class="font-semibold">
          Status
        </h3>
      </div>
    </template>

    <div class="space-y-4">
      <UFormField
        :name="name ? `${name}.status` : 'status'"
        label="Trigger Status"
        description="Control whether this trigger is enabled or disabled"
      >
        <URadioGroup
          v-model="model"
          :items="statusOptions"
          variant="card"
        />
      </UFormField>

      <UAlert
        v-if="model === 'inactive'"
        color="warning"
        variant="subtle"
        icon="i-lucide-alert-triangle"
        title="Trigger is paused"
        description="This trigger will not fire while inactive. Re-activate it when ready."
      />

      <UAlert
        v-if="model === 'retired'"
        color="neutral"
        variant="subtle"
        icon="i-lucide-archive"
        title="Trigger is retired"
        description="Retired triggers are permanently disabled but kept for historical reference. Consider deleting if no longer needed."
      />
    </div>
  </UCard>
</template>

<script setup lang="ts">
const props = defineProps<{
  status?: 'active' | 'inactive' | 'retired'
  name?: string
  nested?: boolean
}>()

const model = defineModel<'active' | 'inactive' | 'retired'>({
  default: 'active',
})

// Initialize from prop if provided
if (props.status) {
  model.value = props.status
}

const statusOptions = [
  {
    value: 'active',
    label: 'Active',
    description: 'Trigger is enabled and will fire when conditions are met',
  },
  {
    value: 'inactive',
    label: 'Inactive',
    description: 'Trigger is temporarily disabled but can be re-enabled later',
  },
  {
    value: 'retired',
    label: 'Retired',
    description: 'Trigger is permanently disabled but kept for historical reference',
  },
]
</script>
