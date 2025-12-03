<template>
  <component :is="noCard ? 'div' : UCard">
    <template
      v-if="!noCard"
      #header
    >
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
      nested
      :name="name"
      :schema="schema"
      :class="noCard ? 'space-y-6' : 'space-y-4'"
    >
      <!-- Schedule Type Toggle -->
      <UFormField
        label="Schedule Type"
        name="scheduleType"
      >
        <URadioGroup
          v-model="scheduleType"
          :items="scheduleTypeOptions"
        />
      </UFormField>

      <!-- Simple Interval Mode -->
      <template v-if="scheduleType === 'interval'">
        <UFormField
          label="Run Every"
          name="interval"
          required
        >
          <template #hint>
            <span class="text-xs text-gray-500">How often should this trigger run?</span>
          </template>
          <div class="flex gap-2">
            <UInput
              v-model="intervalValue"
              type="number"
              min="1"
              placeholder="5"
              icon="i-lucide-timer"
              class="flex-1"
            />
            <USelectMenu
              v-model="intervalUnit"
              :items="intervalUnitOptions"
              value-key="value"
              class="w-32"
            />
          </div>
        </UFormField>
      </template>

      <!-- Simple Preset Mode -->
      <template v-if="scheduleType === 'preset'">
        <UFormField
          label="Schedule Preset"
          name="preset"
          required
        >
          <template #hint>
            <span class="text-xs text-gray-500">Choose a common schedule pattern</span>
          </template>
          <USelectMenu
            v-model="selectedPreset"
            :items="presetOptions"
            value-key="value"
            placeholder="Select a preset"
            class="w-full"
          >
            <template #label>
              <div
                v-if="selectedPreset"
                class="flex items-center gap-2"
              >
                <UIcon
                  :name="selectedPreset.icon"
                  class="w-4 h-4"
                />
                <span>{{ selectedPreset.label }}</span>
              </div>
              <span v-else>Select a preset</span>
            </template>
            <template #option="{ option }">
              <div class="flex items-center justify-between gap-2 w-full">
                <div class="flex items-center gap-2">
                  <UIcon
                    :name="option.icon"
                    class="w-4 h-4"
                  />
                  <span>{{ option.label }}</span>
                </div>
                <span class="text-xs text-gray-500">{{ option.description }}</span>
              </div>
            </template>
          </USelectMenu>
        </UFormField>
      </template>

      <!-- Advanced Cron Mode -->
      <template v-if="scheduleType === 'cron'">
        <UFormField
          label="Cron Expression"
          name="cron"
          required
        >
          <template #hint>
            <span class="text-xs text-gray-500">Standard cron format (minute hour day month weekday)</span>
          </template>
          <UInput
            v-model="config.cron"
            placeholder="0 0 * * *"
            icon="i-lucide-clock"
            :hint="cronHint"
          />
        </UFormField>

        <div
          v-if="config.cron"
          class="p-3 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-900/30 rounded-lg"
        >
          <div class="flex items-start gap-2">
            <UIcon
              name="i-lucide-info"
              class="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5"
            />
            <div class="text-xs text-blue-600 dark:text-blue-400">
              <div class="font-medium mb-1">
                Cron Pattern: {{ config.cron }}
              </div>
              <div class="text-blue-500 dark:text-blue-500">
                {{ cronDescription }}
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- Timezone Selection -->
      <UFormField
        label="Timezone"
        name="timezone"
        required
      >
        <template #hint>
          <span class="text-xs text-gray-500">Select the timezone for this schedule</span>
        </template>
        <USelectMenu
          v-model="config.timezone"
          :items="timezoneOptions"
          searchable
          placeholder="Search timezone..."
          class="w-full"
        >
          <template #label>
            <div class="flex items-center gap-2">
              <UIcon
                name="i-lucide-globe"
                class="w-4 h-4"
              />
              <span>{{ config.timezone }}</span>
            </div>
          </template>
        </USelectMenu>
      </UFormField>
    </UForm>
  </component>
</template>

<script setup lang="ts">
import { ref, computed, watch } from '#imports'
import { UCard } from '#components'
import { z } from 'zod'

const { noCard = false, name = 'schedule' } = defineProps<{
  noCard?: boolean
  name?: string
}>()

const config = defineModel<{
  cron?: string
  interval?: number
  timezone: string
}>({ required: true })

// Schedule type (interval, preset, or cron)
const scheduleType = ref<'interval' | 'preset' | 'cron'>('interval')

// Interval configuration
const intervalValue = ref<number>(5)
const intervalUnit = ref('minutes')

const scheduleTypeOptions = [
  { value: 'interval', label: 'Simple Interval', description: 'Run every N minutes/hours/days' },
  { value: 'preset', label: 'Common Patterns', description: 'Daily, weekly, monthly, etc.' },
  { value: 'cron', label: 'Advanced (Cron)', description: 'Custom cron expression' },
]

const intervalUnitOptions = [
  { label: 'Seconds', value: 'seconds' },
  { label: 'Minutes', value: 'minutes' },
  { label: 'Hours', value: 'hours' },
  { label: 'Days', value: 'days' },
]

const presetOptions = [
  { value: '* * * * *', label: 'Every Minute', description: '* * * * *', icon: 'i-lucide-clock' },
  { value: '0 * * * *', label: 'Every Hour', description: '0 * * * *', icon: 'i-lucide-clock' },
  { value: '0 0 * * *', label: 'Daily at Midnight', description: '0 0 * * *', icon: 'i-lucide-sun' },
  { value: '0 9 * * *', label: 'Daily at 9 AM', description: '0 9 * * *', icon: 'i-lucide-sunrise' },
  { value: '0 17 * * *', label: 'Daily at 5 PM', description: '0 17 * * *', icon: 'i-lucide-sunset' },
  { value: '0 0 * * 0', label: 'Weekly (Sunday)', description: '0 0 * * 0', icon: 'i-lucide-calendar' },
  { value: '0 0 * * 1', label: 'Weekly (Monday)', description: '0 0 * * 1', icon: 'i-lucide-calendar' },
  { value: '0 0 1 * *', label: 'Monthly (1st)', description: '0 0 1 * *', icon: 'i-lucide-calendar-days' },
  { value: '0 0 1 1 *', label: 'Yearly (Jan 1st)', description: '0 0 1 1 *', icon: 'i-lucide-calendar-clock' },
]

const selectedPreset = ref(presetOptions[0])

// Common timezones
const timezoneOptions = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Rome',
  'Europe/Madrid',
  'Europe/Amsterdam',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Singapore',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Pacific/Auckland',
]

// Initialize schedule type based on existing config
if (config.value.cron) {
  // Check if it matches a preset
  const matchingPreset = presetOptions.find(p => p.value === config.value.cron)
  if (matchingPreset) {
    scheduleType.value = 'preset'
    selectedPreset.value = matchingPreset
  }
  else {
    scheduleType.value = 'cron'
  }
}
else if (config.value.interval) {
  scheduleType.value = 'interval'
  // Convert interval to value + unit
  const seconds = config.value.interval
  if (seconds % 86400 === 0) {
    intervalValue.value = seconds / 86400
    intervalUnit.value = 'days'
  }
  else if (seconds % 3600 === 0) {
    intervalValue.value = seconds / 3600
    intervalUnit.value = 'hours'
  }
  else if (seconds % 60 === 0) {
    intervalValue.value = seconds / 60
    intervalUnit.value = 'minutes'
  }
  else {
    intervalValue.value = seconds
    intervalUnit.value = 'seconds'
  }
}
else {
  // Initialize with default interval (5 minutes = 300 seconds)
  scheduleType.value = 'interval'
  intervalValue.value = 5
  intervalUnit.value = 'minutes'
  config.value.interval = 300
  config.value.cron = undefined
}

// Watch unit changes to convert the displayed value
watch(intervalUnit, (newUnit, oldUnit) => {
  if (scheduleType.value === 'interval' && oldUnit && newUnit !== oldUnit) {
    const multipliers = {
      seconds: 1,
      minutes: 60,
      hours: 3600,
      days: 86400,
    }

    const oldMultiplier = multipliers[oldUnit as keyof typeof multipliers] || 1
    const newMultiplier = multipliers[newUnit as keyof typeof multipliers] || 1

    // Convert the current value to the new unit
    const currentSeconds = Number(intervalValue.value) * oldMultiplier
    const newValue = currentSeconds / newMultiplier

    // Round to 2 decimal places for display, but ensure minimum of 1
    intervalValue.value = Math.max(1, Math.round(newValue * 100) / 100)
  }
})

// Update config when interval changes
watch([intervalValue, intervalUnit], () => {
  if (scheduleType.value === 'interval') {
    const multiplier = {
      seconds: 1,
      minutes: 60,
      hours: 3600,
      days: 86400,
    }[intervalUnit.value] || 1

    // Ensure intervalValue is a number
    const numValue = Number(intervalValue.value) || 1
    config.value.interval = numValue * multiplier
    config.value.cron = undefined
  }
}, { immediate: false })

// Update config when preset changes
watch(selectedPreset, (newPreset) => {
  if (scheduleType.value === 'preset' && newPreset) {
    config.value.cron = newPreset.value
    config.value.interval = undefined
  }
})

// Update config when schedule type changes
watch(scheduleType, (newType) => {
  if (newType === 'interval') {
    const multiplier = {
      seconds: 1,
      minutes: 60,
      hours: 3600,
      days: 86400,
    }[intervalUnit.value] || 1
    config.value.interval = intervalValue.value * multiplier
    config.value.cron = undefined
  }
  else if (newType === 'preset') {
    config.value.cron = selectedPreset.value?.value || '0 0 * * *'
    config.value.interval = undefined
  }
  else if (newType === 'cron') {
    // Keep existing cron or set a default
    if (!config.value.cron) {
      config.value.cron = '0 0 * * *'
    }
    config.value.interval = undefined
  }
})

// Cron hint and description
const cronHint = computed(() => {
  return 'Format: minute(0-59) hour(0-23) day(1-31) month(1-12) weekday(0-6)'
})

const cronDescription = computed(() => {
  if (!config.value.cron)
    return ''

  const parts = config.value.cron.trim().split(/\s+/)
  if (parts.length !== 5)
    return 'Invalid cron expression (must have 5 parts)'

  const [minute = '*', hour = '*', day = '*', month = '*', weekday = '*'] = parts

  const descriptions = []

  // Minutes
  if (minute === '*')
    descriptions.push('every minute')
  else if (minute.includes('/'))
    descriptions.push(`every ${minute.split('/')[1]} minutes`)
  else descriptions.push(`at minute ${minute}`)

  // Hours
  if (hour === '*')
    descriptions.push('of every hour')
  else if (hour.includes('/'))
    descriptions.push(`every ${hour.split('/')[1]} hours`)
  else descriptions.push(`at ${hour}:00`)

  // Day
  if (day !== '*') {
    descriptions.push(`on day ${day}`)
  }

  // Month
  if (month !== '*') {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const monthIndex = Number.parseInt(month) - 1
    if (monthIndex >= 0 && monthIndex < 12) {
      descriptions.push(`in ${months[monthIndex]}`)
    }
  }

  // Weekday
  if (weekday !== '*') {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const dayIndex = Number.parseInt(weekday)
    if (dayIndex >= 0 && dayIndex < 7) {
      descriptions.push(`on ${days[dayIndex]}`)
    }
  }

  return descriptions.join(', ')
})

const schema = z.object({
  cron: z.string().optional(),
  interval: z.number().min(1, 'Interval must be at least 1 second').optional(),
  timezone: z.string().min(1, 'Timezone is required'),
  scheduleType: z.enum(['interval', 'preset', 'cron']).optional(),
  preset: z.string().optional(),
}).refine(
  data => data.cron || data.interval,
  { message: 'Please configure a schedule', path: ['interval'] },
)
</script>
