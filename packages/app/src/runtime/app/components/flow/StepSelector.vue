<template>
  <div :class="ui.root">
    <component
      :is="item.clickable !== false ? 'button' : 'div'"
      v-for="item in items"
      :key="item.value"
      :type="item.clickable !== false ? 'button' : undefined"
      :class="itemClasses(item)"
      @click="item.clickable !== false ? $emit('update:modelValue', item.value) : undefined"
    >
      <!-- Status Icon or All Icon -->
      <div
        class="flex-shrink-0"
        :class="item.step.showAllIndicator ? '' : 'mt-0.5'"
      >
        <div
          v-if="item.step.showAllIndicator"
          class="w-6 h-6 rounded-full flex items-center justify-center bg-gray-100 dark:bg-gray-800"
        >
          <UIcon
            name="i-lucide-layers"
            class="w-3 h-3 text-gray-600 dark:text-gray-400"
          />
        </div>
        <div
          v-else
          class="w-8 h-8 rounded-full flex items-center justify-center"
          :class="getStepStatusBg(item.step.status)"
        >
          <UIcon
            :name="getStepStatusIcon(item.step.status)"
            class="w-4 h-4"
            :class="getStepStatusIconColor(item.step.status)"
          />
        </div>
      </div>

      <!-- Step Details -->
      <div class="flex-1 min-w-0 ml-3">
        <div class="flex items-center gap-2">
          <h4 class="text-sm font-medium text-gray-900 dark:text-gray-100">
            {{ getStepDisplayName(item.step.key) }}
          </h4>
          <!-- Await Badge with Type Icon -->
          <UBadge
            v-if="isAwaitStep(item.step.key)"
            size="xs"
            :color="getAwaitBadgeColor(item.step.status)"
            variant="subtle"
            class="flex items-center gap-1"
          >
            <UIcon
              :name="getAwaitTypeIcon(item.step.awaitType)"
              class="w-3 h-3"
            />
            <span>{{ getAwaitTypeLabel(item.step.awaitType) }}</span>
          </UBadge>
        </div>
        <div
          v-if="!item.step.showAllIndicator"
          class="flex items-center gap-3 mt-1 text-xs text-gray-500"
        >
          <span
            class="capitalize"
            :class="getStepStatusTextColor(item.step.status)"
          >
            {{ item.step.status || 'pending' }}
          </span>
          <span v-if="item.step.attempt && item.step.attempt > 1">
            Attempt {{ item.step.attempt }}
          </span>
          <!-- Await Position Badge -->
          <UBadge
            v-if="isAwaitStep(item.step.key)"
            size="xs"
            color="neutral"
            variant="outline"
          >
            {{ getAwaitPosition(item.step.key) }}
          </UBadge>
        </div>
        <div
          v-else
          class="mt-1 text-xs text-gray-500"
        >
          Show all events from all steps
        </div>

        <!-- Additional Details (from description slot) -->
        <div
          v-if="!item.step.showAllIndicator && (item.step.startedAt || item.step.completedAt || item.step.error || item.step.awaitType)"
          class="mt-3"
        >
          <!-- Timing Info -->
          <div
            v-if="item.step.startedAt || item.step.completedAt"
            class="flex items-center gap-4 text-xs text-gray-500"
          >
            <div
              v-if="item.step.startedAt"
              class="flex items-center gap-1"
            >
              <UIcon
                name="i-lucide-clock"
                class="w-3 h-3"
              />
              <span>{{ formatTime(item.step.startedAt) }}</span>
            </div>
            <div
              v-if="item.step.completedAt"
              class="flex items-center gap-1"
            >
              <UIcon
                name="i-lucide-check-circle"
                class="w-3 h-3"
              />
              <span>{{ formatTime(item.step.completedAt) }}</span>
            </div>
          </div>

          <!-- Error Message -->
          <div
            v-if="item.step.error"
            class="mt-2"
          >
            <div
              class="p-2 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded text-xs text-red-600 dark:text-red-400"
              :title="String(item.step.error || '')"
            >
              <div class="flex items-start gap-1">
                <UIcon
                  name="i-lucide-alert-circle"
                  class="w-3 h-3 flex-shrink-0 mt-0.5"
                />
                <p class="line-clamp-2 break-all">
                  {{ item.step.error }}
                </p>
              </div>
            </div>
          </div>

          <!-- Await Config Details -->
          <div
            v-if="item.step.awaitType"
            class="mt-2 p-2.5 rounded-md border"
            :class="getAwaitConfigBgClass(item.step.status)"
          >
            <div class="flex flex-col gap-2">
              <!-- Primary Info -->
              <div class="flex items-center gap-2">
                <UIcon
                  :name="getAwaitTypeIcon(item.step.awaitType)"
                  class="w-3.5 h-3.5"
                  :class="getAwaitIconColor(item.step.status)"
                />
                <span
                  class="font-medium"
                  :class="getAwaitTextColor(item.step.status)"
                >
                  {{ getAwaitTypeLabel(item.step.awaitType) }} Pattern
                </span>
              </div>

              <!-- Configuration Details -->
              <div class="space-y-1.5 text-xs">
                <!-- Webhook specific -->
                <div
                  v-if="item.step.awaitType === 'webhook' && item.step.awaitConfig"
                  class="space-y-1"
                >
                  <div
                    v-if="item.step.awaitConfig.method"
                    class="flex items-center gap-1.5"
                  >
                    <UIcon
                      name="i-lucide-route"
                      class="w-3 h-3 opacity-60"
                    />
                    <span class="opacity-75">Method:</span>
                    <UBadge
                      size="xs"
                      :color="getMethodBadgeColor(item.step.awaitConfig.method)"
                      variant="subtle"
                    >
                      {{ item.step.awaitConfig.method }}
                    </UBadge>
                  </div>
                  <div
                    v-if="item.step.awaitConfig.path"
                    class="flex items-start gap-1.5"
                  >
                    <UIcon
                      name="i-lucide-link"
                      class="w-3 h-3 opacity-60 mt-0.5"
                    />
                    <span class="opacity-75">Path:</span>
                    <code class="px-1.5 py-0.5 bg-black/5 dark:bg-white/5 rounded text-[10px] flex-1">{{ item.step.awaitConfig.path }}</code>
                  </div>
                  <div
                    v-if="item.step.webhookUrl"
                    class="flex items-start gap-1.5 pt-1"
                  >
                    <UIcon
                      name="i-lucide-globe"
                      class="w-3 h-3 opacity-60 mt-1"
                    />
                    <span class="opacity-75 mt-0.5">URL:</span>
                    <div class="flex-1 flex items-start gap-1">
                      <code class="px-1.5 py-0.5 bg-black/5 dark:bg-white/5 rounded text-[10px] flex-1 break-all">{{ item.step.webhookUrl }}</code>
                      <button
                        type="button"
                        class="flex-shrink-0 p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded transition-colors"
                        :title="copiedUrl === item.step.webhookUrl ? 'Copied!' : 'Copy URL'"
                        @click.stop="copyToClipboard(item.step.webhookUrl)"
                      >
                        <UIcon
                          :name="copiedUrl === item.step.webhookUrl ? 'i-lucide-check' : 'i-lucide-copy'"
                          class="w-3 h-3"
                          :class="copiedUrl === item.step.webhookUrl ? 'text-emerald-600 dark:text-emerald-400' : 'opacity-60'"
                        />
                      </button>
                    </div>
                  </div>
                </div>

                <!-- Event specific -->
                <div
                  v-if="item.step.awaitType === 'event' && item.step.awaitConfig?.event"
                  class="flex items-center gap-1.5"
                >
                  <UIcon
                    name="i-lucide-radio"
                    class="w-3 h-3 opacity-60"
                  />
                  <span class="opacity-75">Event:</span>
                  <code class="px-1.5 py-0.5 bg-black/5 dark:bg-white/5 rounded text-xs">{{ item.step.awaitConfig.event }}</code>
                </div>

                <!-- Time specific -->
                <div
                  v-if="item.step.awaitType === 'time' && item.step.awaitConfig?.delay"
                  class="flex items-center gap-1.5"
                >
                  <UIcon
                    name="i-lucide-hourglass"
                    class="w-3 h-3 opacity-60"
                  />
                  <span class="opacity-75">Delay:</span>
                  <span class="font-medium">{{ formatDuration(item.step.awaitConfig.delay) }}</span>
                </div>

                <!-- Timeout -->
                <div
                  v-if="item.step.awaitConfig?.timeout"
                  class="flex items-center gap-1.5"
                >
                  <UIcon
                    name="i-lucide-clock-alert"
                    class="w-3 h-3 opacity-60"
                  />
                  <span class="opacity-75">Timeout:</span>
                  <span class="font-medium">{{ formatDuration(item.step.awaitConfig.timeout) }}</span>
                </div>

                <!-- Timeout Action -->
                <div
                  v-if="item.step.awaitConfig?.timeoutAction"
                  class="flex items-center gap-1.5"
                >
                  <UIcon
                    name="i-lucide-zap"
                    class="w-3 h-3 opacity-60"
                  />
                  <span class="opacity-75">On Timeout:</span>
                  <UBadge
                    size="xs"
                    :color="getTimeoutActionColor(item.step.awaitConfig.timeoutAction)"
                    variant="subtle"
                  >
                    {{ item.step.awaitConfig.timeoutAction }}
                  </UBadge>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </component>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { tv } from 'tailwind-variants'
import { twMerge } from 'tailwind-merge'
import type { ClassValue } from 'tailwind-variants'

const props = defineProps<{
  modelValue: string
  items: Array<{
    value: string
    label: string
    step: any
    clickable?: boolean
  }>
  ui?: {
    root?: ClassValue
    item?: ClassValue
    itemSelected?: ClassValue
    itemBase?: ClassValue
  }
}>()

defineEmits<{
  'update:modelValue': [value: string]
}>()

// Copy to clipboard functionality
const copiedUrl = ref<string | null>(null)

const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)
    copiedUrl.value = text
    setTimeout(() => {
      copiedUrl.value = null
    }, 2000)
  }
  catch (err) {
    console.error('Failed to copy:', err)
  }
}

// Default UI configuration
const defaultUi = {
  root: 'space-y-3',
  itemBase: 'w-full flex items-start border rounded-lg text-sm p-3.5 transition-colors text-left',
  itemClickable: 'hover:bg-gray-50 dark:hover:bg-gray-900/50 cursor-pointer',
  itemNonClickable: 'bg-blue-50/50 dark:bg-blue-900/10 opacity-75 cursor-default',
  item: 'border-gray-200 dark:border-gray-800',
  itemSelected: 'border-primary bg-primary/5 dark:bg-primary/10',
}

// Merge user UI with default UI
const ui = computed(() => ({
  root: twMerge(defaultUi.root, props.ui?.root as string),
  itemBase: twMerge(defaultUi.itemBase, props.ui?.itemBase as string),
  itemClickable: defaultUi.itemClickable,
  itemNonClickable: defaultUi.itemNonClickable,
  item: props.ui?.item as string || defaultUi.item,
  itemSelected: props.ui?.itemSelected as string || defaultUi.itemSelected,
}))

// Create item variant using tailwind-variants
const itemVariants = computed(() => tv({
  base: ui.value.itemBase,
  variants: {
    selected: {
      true: ui.value.itemSelected,
      false: ui.value.item,
    },
    clickable: {
      true: ui.value.itemClickable,
      false: ui.value.itemNonClickable,
    },
  },
}))

// Compute classes for each item
const itemClasses = (item: any) => {
  const isClickable = item.clickable !== false
  return itemVariants.value({
    selected: isClickable && props.modelValue === item.value,
    clickable: isClickable,
  })
}

// Helper to format timestamps
const formatTime = (timestamp: string | number | Date) => {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0)
    return `${days}d ago`
  if (hours > 0)
    return `${hours}h ago`
  if (minutes > 0)
    return `${minutes}m ago`
  if (seconds > 10)
    return `${seconds}s ago`
  return 'just now'
}

// Step status helpers
const getStepStatusBg = (status?: string) => {
  switch (status) {
    case 'completed': return 'bg-emerald-50 dark:bg-emerald-900/20'
    case 'failed': return 'bg-red-50 dark:bg-red-900/20'
    case 'running': return 'bg-blue-50 dark:bg-blue-900/20'
    default: return 'bg-gray-50 dark:bg-gray-900/20'
  }
}

const getStepStatusIcon = (status?: string) => {
  switch (status) {
    case 'completed': return 'i-lucide-check-circle'
    case 'failed': return 'i-lucide-x-circle'
    case 'running': return 'i-lucide-loader-circle'
    default: return 'i-lucide-circle'
  }
}

const getStepStatusIconColor = (status?: string) => {
  switch (status) {
    case 'completed': return 'text-emerald-600 dark:text-emerald-400'
    case 'failed': return 'text-red-600 dark:text-red-400'
    case 'running': return 'text-blue-600 dark:text-blue-400 animate-spin'
    default: return 'text-gray-400'
  }
}

const getStepStatusTextColor = (status?: string) => {
  switch (status) {
    case 'completed': return 'text-emerald-600 dark:text-emerald-400'
    case 'failed': return 'text-red-600 dark:text-red-400'
    case 'running': return 'text-blue-600 dark:text-blue-400'
    default: return 'text-gray-500'
  }
}

// Await step helpers
const isAwaitStep = (key: string) => {
  return key.includes(':await-')
}

const getAwaitPosition = (key: string) => {
  if (key.includes(':await-before')) return 'before'
  if (key.includes(':await-after')) return 'after'
  return ''
}

const getStepDisplayName = (key: string) => {
  // Remove :await-before or :await-after suffix for display
  if (key.includes(':await-')) {
    return key.split(':await-')[0]
  }
  return key
}

const getAwaitTypeIcon = (type?: string) => {
  switch (type) {
    case 'webhook': return 'i-lucide-webhook'
    case 'event': return 'i-lucide-zap'
    case 'time': return 'i-lucide-clock'
    case 'schedule': return 'i-lucide-calendar-clock'
    default: return 'i-lucide-timer'
  }
}

const getAwaitTypeLabel = (type?: string) => {
  switch (type) {
    case 'webhook': return 'Webhook'
    case 'event': return 'Event'
    case 'time': return 'Time'
    case 'schedule': return 'Schedule'
    default: return 'Await'
  }
}

const getAwaitBadgeColor = (status?: string) => {
  switch (status) {
    case 'waiting': return 'warning'
    case 'completed': return 'success'
    case 'timeout': return 'error'
    default: return 'neutral'
  }
}

const getAwaitConfigBgClass = (status?: string) => {
  switch (status) {
    case 'waiting':
      return 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-900/30 text-amber-700 dark:text-amber-300'
    case 'completed':
      return 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-900/30 text-emerald-700 dark:text-emerald-300'
    case 'timeout':
      return 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-900/30 text-red-700 dark:text-red-300'
    default:
      return 'bg-gray-50 dark:bg-gray-900/10 border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300'
  }
}

const getAwaitIconColor = (status?: string) => {
  switch (status) {
    case 'waiting': return 'text-amber-600 dark:text-amber-400'
    case 'completed': return 'text-emerald-600 dark:text-emerald-400'
    case 'timeout': return 'text-red-600 dark:text-red-400'
    default: return 'text-gray-600 dark:text-gray-400'
  }
}

const getAwaitTextColor = (status?: string) => {
  switch (status) {
    case 'waiting': return 'text-amber-700 dark:text-amber-300'
    case 'completed': return 'text-emerald-700 dark:text-emerald-300'
    case 'timeout': return 'text-red-700 dark:text-red-300'
    default: return 'text-gray-700 dark:text-gray-300'
  }
}

const getMethodBadgeColor = (method?: string) => {
  switch (method?.toUpperCase()) {
    case 'GET': return 'primary'
    case 'POST': return 'success'
    case 'PUT': return 'warning'
    case 'DELETE': return 'error'
    default: return 'neutral'
  }
}

const getTimeoutActionColor = (action?: string) => {
  switch (action) {
    case 'fail': return 'error'
    case 'continue': return 'success'
    case 'retry': return 'warning'
    default: return 'neutral'
  }
}

const formatDuration = (ms: number) => {
  if (!ms) return '—'
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) {
    const remainingHours = hours % 24
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`
  }
  if (hours > 0) {
    const remainingMinutes = minutes % 60
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
  }
  if (minutes > 0) {
    const remainingSeconds = seconds % 60
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
  }
  return `${seconds}s`
}
</script>
