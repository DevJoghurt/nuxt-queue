<template>
  <UModal v-model:open="isOpen">
    <template #header>
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-lg font-semibold">
            Schedule Flow
          </h3>
          <p class="text-sm text-gray-500 mt-1">
            {{ flowName }}
          </p>
        </div>
      </div>
    </template>
    <template #body>
      <div class="space-y-4">
        <!-- Schedule Type -->
        <div>
          <label class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
            Schedule Type
          </label>
          <UTabs
            v-model="scheduleType"
            :items="typeOptions"
            size="sm"
            variant="pill"
            color="neutral"
          />
        </div>

        <!-- Cron Pattern -->
        <div v-if="scheduleType === 'cron'">
          <label class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
            Pattern
          </label>
          <USelectMenu
            v-model="selectedPreset"
            :items="cronPresets"
            placeholder="Select preset or custom"
          />
          <UInput
            v-if="selectedPreset?.value === 'custom'"
            v-model="customCron"
            placeholder="0 2 * * *"
            class="mt-2"
          />
        </div>

        <!-- Delay -->
        <div v-else-if="scheduleType === 'delay'">
          <label class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
            Delay
          </label>
          <div class="flex gap-2">
            <UInput
              v-model="delayValue"
              type="number"
              placeholder="5"
              class="flex-1"
            />
            <USelectMenu
              v-model="delayUnit"
              :items="delayUnits"
              class="w-32"
            />
          </div>
        </div>

        <!-- Input Data -->
        <div>
          <label class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
            Input Data (JSON)
          </label>
          <UTextarea
            v-model="inputJson"
            placeholder="{ &quot;key&quot;: &quot;value&quot; }"
            :rows="4"
            class="font-mono text-sm"
          />
          <p
            v-if="jsonError"
            class="text-xs text-red-500 mt-1"
          >
            {{ jsonError }}
          </p>
        </div>

        <!-- Description -->
        <div>
          <label class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
            Description (optional)
          </label>
          <UInput
            v-model="description"
            placeholder="Daily cleanup job"
          />
        </div>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          @click="isOpen = false"
        >
          Cancel
        </UButton>
        <UButton
          color="primary"
          :loading="isSubmitting"
          :disabled="!canSubmit"
          @click="handleSubmit"
        >
          Schedule Flow
        </UButton>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from '#imports'
import { UModal, UButton, UTabs, USelectMenu, UInput, UTextarea } from '#components'

const props = defineProps<{
  flowName: string
}>()

const emit = defineEmits<{
  scheduled: []
}>()

const isOpen = defineModel<boolean>({ default: false })

const scheduleType = ref<'cron' | 'delay'>('cron')
const typeOptions = [
  { label: 'Recurring (Cron)', value: 'cron' },
  { label: 'One-time (Delay)', value: 'delay' },
]

const cronPresets = [
  { label: 'Every minute', value: '* * * * *' },
  { label: 'Every 5 minutes', value: '*/5 * * * *' },
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Daily at 2 AM', value: '0 2 * * *' },
  { label: 'Daily at noon', value: '0 12 * * *' },
  { label: 'Weekly (Monday 9 AM)', value: '0 9 * * 1' },
  { label: 'Monthly (1st at midnight)', value: '0 0 1 * *' },
  { label: 'Custom', value: 'custom' },
]

const selectedPreset = ref<{ label: string, value: string }>(cronPresets[3]!)
const customCron = ref('')

const delayValue = ref('5')
const delayUnit = ref<{ label: string, value: number }>({ label: 'Minutes', value: 60000 })
const delayUnits = [
  { label: 'Seconds', value: 1000 },
  { label: 'Minutes', value: 60000 },
  { label: 'Hours', value: 3600000 },
  { label: 'Days', value: 86400000 },
]

const inputJson = ref('')
const description = ref('')
const isSubmitting = ref(false)

const jsonError = computed(() => {
  if (!inputJson.value)
    return null
  try {
    JSON.parse(inputJson.value)
    return null
  }
  catch (e: any) {
    return `Invalid JSON: ${e.message}`
  }
})

const canSubmit = computed(() => {
  if (jsonError.value)
    return false
  if (scheduleType.value === 'cron') {
    if (selectedPreset.value?.value === 'custom') {
      return customCron.value.trim().length > 0
    }
    return selectedPreset.value?.value != null
  }
  else {
    const num = Number.parseInt(delayValue.value)
    return !Number.isNaN(num) && num > 0
  }
})

const handleSubmit = async () => {
  isSubmitting.value = true
  try {
    let input: any = {}
    if (inputJson.value) {
      input = JSON.parse(inputJson.value)
    }

    const body: any = {
      input,
      metadata: {
        description: description.value || undefined,
      },
    }

    if (scheduleType.value === 'cron') {
      body.cron = selectedPreset.value?.value === 'custom'
        ? customCron.value
        : selectedPreset.value?.value
    }
    else {
      const num = Number.parseInt(delayValue.value)
      body.delay = num * delayUnit.value.value
    }

    await $fetch(`/api/_flows/${props.flowName}/schedule`, {
      method: 'POST',
      body,
    })

    emit('scheduled')
    isOpen.value = false

    // Reset form
    inputJson.value = ''
    description.value = ''
    customCron.value = ''
    delayValue.value = '5'
  }
  finally {
    isSubmitting.value = false
  }
}

// Reset form when modal closes
watch(isOpen, (newVal) => {
  if (!newVal) {
    scheduleType.value = 'cron'
    selectedPreset.value = cronPresets[3]!
    inputJson.value = ''
    description.value = ''
    customCron.value = ''
    delayValue.value = '5'
  }
})
</script>
