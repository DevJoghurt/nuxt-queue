<template>
  <div class="h-full flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
    <!-- Header -->
    <div class="border-b border-gray-200 dark:border-gray-800 px-6 py-4 shrink-0 bg-white dark:bg-gray-900">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <UButton
            icon="i-lucide-arrow-left"
            size="sm"
            color="neutral"
            variant="ghost"
            @click="router.push('/triggers')"
          />
          <div>
            <h1 class="text-lg font-semibold">
              Create New Trigger
            </h1>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Configure a trigger to start flows automatically
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex-1 min-h-0 overflow-y-auto">
      <div class="max-w-4xl mx-auto py-8 px-6">
        <!-- Stepper -->
        <UStepper
          v-model="currentStep"
          :items="steps"
          orientation="horizontal"
          class="mb-8"
        />

        <!-- Step Content -->
        <div class="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm">
          <!-- Step 1: Type Selection -->
          <div v-show="currentStep === 1">
            <div class="p-6 border-b border-gray-200 dark:border-gray-800">
              <h2 class="text-xl font-semibold mb-2">
                Select Trigger Type
              </h2>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                Choose how you want to trigger your flows
              </p>
            </div>
            <div class="p-6">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button
                  v-for="type in triggerTypes"
                  :key="type.value"
                  class="group relative p-6 rounded-lg border-2 transition-all text-left"
                  :class="formData.type === type.value 
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-950/30' 
                    : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700'"
                  @click="selectType(type.value)"
                >
                  <div class="flex items-start gap-4">
                    <div
                      class="w-12 h-12 rounded-lg flex items-center justify-center shrink-0 transition-colors"
                      :class="formData.type === type.value 
                        ? 'bg-primary-100 dark:bg-primary-900/40' 
                        : 'bg-gray-100 dark:bg-gray-800 group-hover:bg-gray-200 dark:group-hover:bg-gray-700'"
                    >
                      <UIcon
                        :name="type.icon"
                        class="w-6 h-6"
                        :class="formData.type === type.value ? 'text-primary-600 dark:text-primary-400' : 'text-gray-600 dark:text-gray-400'"
                      />
                    </div>
                    <div class="flex-1 min-w-0">
                      <h3 class="text-base font-semibold mb-1">
                        {{ type.label }}
                      </h3>
                      <p class="text-sm text-gray-500 dark:text-gray-400">
                        {{ type.description }}
                      </p>
                      <div class="flex items-center gap-2 mt-3">
                        <UBadge
                          :label="type.scope"
                          size="xs"
                          color="neutral"
                          variant="subtle"
                        />
                        <span class="text-xs text-gray-400">•</span>
                        <span class="text-xs text-gray-500 dark:text-gray-400">
                          {{ type.useCase }}
                        </span>
                      </div>
                    </div>
                    <div
                      v-if="formData.type === type.value"
                      class="absolute top-4 right-4"
                    >
                      <div class="w-6 h-6 rounded-full bg-primary-500 flex items-center justify-center">
                        <UIcon
                          name="i-lucide-check"
                          class="w-4 h-4 text-white"
                        />
                      </div>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </div>

          <!-- Step 2: Basic Information -->
          <div v-show="currentStep === 2">
            <div class="p-6 border-b border-gray-200 dark:border-gray-800">
              <h2 class="text-xl font-semibold mb-2">
                Basic Information
              </h2>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                Provide details about your trigger
              </p>
            </div>
            <div class="p-6 space-y-6">
              <div>
                <label class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                  Trigger Name *
                </label>
                <UInput
                  v-model="formData.name"
                  placeholder="e.g., user-signup-trigger"
                  size="lg"
                />
                <p
                  v-if="errors.name"
                  class="text-xs text-red-500 dark:text-red-400 mt-1.5"
                >
                  {{ errors.name }}
                </p>
                <p
                  v-else
                  class="text-xs text-gray-500 dark:text-gray-400 mt-1.5"
                >
                  A unique identifier for this trigger. Use lowercase with hyphens.
                </p>
              </div>

              <div>
                <label class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                  Display Name
                </label>
                <UInput
                  v-model="formData.displayName"
                  placeholder="e.g., User Signup Trigger"
                  size="lg"
                />
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
                  A human-readable name for display purposes.
                </p>
              </div>

              <div>
                <label class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                  Description
                </label>
                <UTextarea
                  v-model="formData.description"
                  placeholder="Describe what this trigger does..."
                  :rows="3"
                />
              </div>
            </div>
          </div>

          <!-- Step 3: Configuration -->
          <div v-show="currentStep === 3">
            <div class="p-6 border-b border-gray-200 dark:border-gray-800">
              <div class="flex items-center gap-3 mb-2">
                <div
                  class="w-10 h-10 rounded-lg flex items-center justify-center"
                  :class="getTriggerTypeBgClass(formData.type)"
                >
                  <UIcon
                    :name="getTriggerTypeIcon(formData.type)"
                    class="w-5 h-5"
                    :class="getTriggerTypeIconClass(formData.type)"
                  />
                </div>
                <div>
                  <h2 class="text-xl font-semibold">
                    {{ getTriggerTypeLabel(formData.type) }} Configuration
                  </h2>
                  <p class="text-sm text-gray-500 dark:text-gray-400">
                    Configure the specific settings for this trigger type
                  </p>
                </div>
              </div>
            </div>
            <div class="p-6 space-y-6">
              <!-- Event Trigger Config -->
              <template v-if="formData.type === 'event'">
              <div>
                <label class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                  Event Name *
                </label>
                <UInput
                  v-model="formData.config.event"
                  placeholder="e.g., user.created"
                  size="lg"
                  icon="i-lucide-radio"
                />
                <p
                  v-if="errors.event"
                  class="text-xs text-red-500 dark:text-red-400 mt-1.5"
                >
                  {{ errors.event }}
                </p>
                <p
                  v-else
                  class="text-xs text-gray-500 dark:text-gray-400 mt-1.5"
                >
                  The event name to listen for. Use dot notation for namespacing.
                </p>
              </div>                <div>
                  <label class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                    Event Filter (Optional)
                    <UBadge
                      label="Advanced"
                      size="xs"
                      color="neutral"
                      variant="subtle"
                    />
                  </label>
                  <UTextarea
                    v-model="formData.config.filter"
                    placeholder='e.g., { "type": "premium" }'
                    :rows="3"
                  />
                  <p class="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
                    JSON filter to match specific event payloads.
                  </p>
                </div>
              </template>

              <!-- Webhook Trigger Config -->
              <template v-if="formData.type === 'webhook'">
                <div>
                  <label class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                    HTTP Method *
                  </label>
                  <USelectMenu
                    v-model="formData.config.method"
                    :items="['POST', 'GET', 'PUT', 'PATCH', 'DELETE']"
                    size="lg"
                  />
                </div>

                <div>
                  <label class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                    Webhook Path *
                  </label>
                  <div class="flex items-center gap-2">
                    <div class="text-sm text-gray-500 dark:text-gray-400 font-mono bg-gray-100 dark:bg-gray-800 px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700">
                      /api/_trigger/
                    </div>
                    <UInput
                      v-model="formData.config.path"
                      placeholder="webhook-name"
                      size="lg"
                      class="flex-1"
                      :error="errors.path"
                    />
                  </div>
                  <p
                    v-if="errors.path"
                    class="text-xs text-red-500 dark:text-red-400 mt-1.5"
                  >
                    {{ errors.path }}
                  </p>
                  <p
                    v-else
                    class="text-xs text-gray-500 dark:text-gray-400 mt-1.5"
                  >
                    The URL path where the webhook will be accessible.
                  </p>
                </div>

                <ClientOnly>
                  <div>
                    <label class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                      <UCheckbox v-model="formData.config.requireAuth" />
                      Require Authentication
                    </label>
                    <p class="text-xs text-gray-500 dark:text-gray-400">
                      When enabled, requests must include a valid API key in the Authorization header.
                    </p>
                  </div>
                </ClientOnly>

                <div v-if="formData.config.requireAuth">
                  <label class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                    API Key Header Name
                  </label>
                  <UInput
                    v-model="formData.config.authHeader"
                    placeholder="X-API-Key"
                    size="lg"
                  />
                </div>
              </template>

              <!-- Schedule Trigger Config -->
              <template v-if="formData.type === 'schedule'">
                <div>
                  <label class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                    Schedule Type *
                  </label>
                  <USelectMenu
                    v-model="formData.config.scheduleType"
                    :items="['cron', 'interval']"
                    size="lg"
                  />
                </div>

                <!-- Cron Expression -->
                <div v-if="formData.config.scheduleType === 'cron'">
                  <label class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                    Cron Expression *
                  </label>
                  <UInput
                    v-model="formData.config.cron"
                    placeholder="0 0 * * *"
                    size="lg"
                    icon="i-lucide-clock"
                  />
                  <p
                    v-if="errors.cron"
                    class="text-xs text-red-500 dark:text-red-400 mt-1.5"
                  >
                    {{ errors.cron }}
                  </p>
                  <p
                    v-else
                    class="text-xs text-gray-500 dark:text-gray-400 mt-1.5"
                  >
                    Standard cron format: minute hour day month weekday
                  </p>
                  <div class="mt-2 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
                    <p class="text-xs text-blue-700 dark:text-blue-300">
                      Examples: "0 0 * * *" (daily at midnight), "*/5 * * * *" (every 5 minutes)
                    </p>
                  </div>
                </div>

                <!-- Interval -->
                <div v-if="formData.config.scheduleType === 'interval'">
                  <div class="grid grid-cols-2 gap-4">
                    <div>
                      <label class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                        Interval Value *
                      </label>
                      <UInput
                        v-model.number="formData.config.intervalValue"
                        type="number"
                        min="1"
                        size="lg"
                      />
                      <p
                        v-if="errors.intervalValue"
                        class="text-xs text-red-500 dark:text-red-400 mt-1.5"
                      >
                        {{ errors.intervalValue }}
                      </p>
                    </div>
                    <div>
                      <label class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                        Interval Unit *
                      </label>
                      <USelectMenu
                        v-model="formData.config.intervalUnit"
                        :items="['seconds', 'minutes', 'hours', 'days']"
                        size="lg"
                      />
                    </div>
                  </div>
                </div>

                <ClientOnly>
                  <div>
                    <label class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                      <UCheckbox v-model="formData.config.runImmediately" />
                      Run Immediately on Registration
                    </label>
                    <p class="text-xs text-gray-500 dark:text-gray-400">
                      Execute the trigger once as soon as it's registered, then follow the schedule.
                    </p>
                  </div>
                </ClientOnly>
              </template>

              <!-- Manual Trigger Config -->
              <template v-if="formData.type === 'manual'">
                <div class="p-4 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800">
                  <div class="flex items-start gap-3">
                    <UIcon
                      name="i-lucide-info"
                      class="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0"
                    />
                    <div>
                      <p class="text-sm text-amber-800 dark:text-amber-200 font-medium mb-1">
                        Manual triggers require no additional configuration
                      </p>
                      <p class="text-xs text-amber-700 dark:text-amber-300">
                        Manual triggers can only be invoked via API calls or the UI. They are useful for on-demand flow execution.
                      </p>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </div>

          <!-- Step 4: Flow Subscriptions -->
          <div v-show="currentStep === 4">
            <div class="p-6">
              <NventTriggerFlowSubscriptions
                :subscriptions="formData.subscriptions"
                :flows="availableFlows"
                @toggle="toggleFlow"
              />
            </div>
          </div>

          <!-- Step 5: Review & Create -->
          <div v-show="currentStep === 5">
            <div class="p-6 border-b border-gray-200 dark:border-gray-800">
              <h2 class="text-xl font-semibold mb-2">
                Review & Create
              </h2>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                Review your trigger configuration before creating it
              </p>
            </div>
            <div class="p-6 space-y-6">
              <!-- Summary Card -->
              <div class="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-6 space-y-4">
                <div class="flex items-start gap-4">
                  <div
                    class="w-12 h-12 rounded-lg flex items-center justify-center shrink-0"
                    :class="getTriggerTypeBgClass(formData.type)"
                  >
                    <UIcon
                      :name="getTriggerTypeIcon(formData.type)"
                      class="w-6 h-6"
                      :class="getTriggerTypeIconClass(formData.type)"
                    />
                  </div>
                  <div class="flex-1 min-w-0">
                    <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
                      {{ formData.displayName || formData.name }}
                    </h3>
                    <p
                      v-if="formData.description"
                      class="text-sm text-gray-600 dark:text-gray-400"
                    >
                      {{ formData.description }}
                    </p>
                    <div class="flex items-center gap-2 mt-2">
                      <UBadge
                        :label="getTriggerTypeLabel(formData.type)"
                        :color="getTriggerTypeColor(formData.type)"
                        variant="subtle"
                      />
                      <UBadge
                        :label="getTriggerScope(formData.type)"
                        color="neutral"
                        variant="subtle"
                      />
                    </div>
                  </div>
                </div>

                <div class="grid grid-cols-2 gap-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <div>
                    <p class="text-xs text-gray-500 dark:text-gray-400 mb-1">
                      Trigger Name
                    </p>
                    <p class="text-sm font-medium font-mono text-gray-900 dark:text-gray-100">
                      {{ formData.name }}
                    </p>
                  </div>
                  <div>
                    <p class="text-xs text-gray-500 dark:text-gray-400 mb-1">
                      Subscriptions
                    </p>
                    <p class="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {{ formData.subscriptions.length }} flow{{ formData.subscriptions.length === 1 ? '' : 's' }}
                    </p>
                  </div>
                </div>
              </div>

              <!-- Configuration Details -->
              <div>
                <h4 class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                  Configuration
                </h4>
                <div class="bg-gray-900 dark:bg-black rounded-lg p-4 font-mono text-sm overflow-x-auto">
                  <pre class="text-gray-100 dark:text-gray-300">{{ JSON.stringify(getReviewConfig(), null, 2) }}</pre>
                </div>
              </div>

              <!-- Subscribed Flows -->
              <div v-if="formData.subscriptions.length > 0">
                <h4 class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                  Subscribed Flows ({{ formData.subscriptions.length }})
                </h4>
                <div class="space-y-2">
                  <div
                    v-for="flowId in formData.subscriptions"
                    :key="flowId"
                    class="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg"
                  >
                    <UIcon
                      name="i-lucide-git-branch"
                      class="w-4 h-4 text-gray-500 dark:text-gray-400"
                    />
                    <span class="text-sm text-gray-900 dark:text-gray-100">{{ flowId }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Navigation Footer -->
          <div class="p-6 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between">
            <UButton
              v-if="currentStep > 1"
              label="Back"
              icon="i-lucide-arrow-left"
              color="neutral"
              variant="ghost"
              @click="previousStep"
            />
            <div v-else />
            <div class="flex items-center gap-3">
              <UButton
                label="Cancel"
                color="neutral"
                variant="ghost"
                @click="router.push('/triggers')"
              />
              <UButton
                v-if="currentStep < 5"
                label="Next"
                icon-trailing="i-lucide-arrow-right"
                @click="nextStep"
              />
              <UButton
                v-else
                label="Create Trigger"
                icon="i-lucide-check"
                :loading="creating"
                @click="createTrigger"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from '#imports'
import { UButton, UIcon, UBadge, UInput, UTextarea, USelectMenu, UCheckbox, UStepper } from '#components'
import { useComponentRouter } from '../../composables/useComponentRouter'
import { useAnalyzedFlows } from '../../composables/useAnalyzedFlows'

const router = useComponentRouter()
const flows = useAnalyzedFlows()

// Stepper state
const currentStep = ref(1)
const steps = [
  { key: 1, label: 'Type', icon: 'i-lucide-sparkles' },
  { key: 2, label: 'Info', icon: 'i-lucide-file-text' },
  { key: 3, label: 'Config', icon: 'i-lucide-settings' },
  { key: 4, label: 'Flows', icon: 'i-lucide-git-branch' },
  { key: 5, label: 'Review', icon: 'i-lucide-check-circle' },
]

// Form data
const formData = ref({
  type: 'event' as 'event' | 'webhook' | 'schedule' | 'manual',
  name: '',
  displayName: '',
  description: '',
  config: {
    // Event
    event: '',
    filter: '',
    // Webhook
    method: 'POST',
    path: '',
    requireAuth: false,
    authHeader: 'X-API-Key',
    // Schedule
    scheduleType: 'cron',
    cron: '',
    intervalValue: 5,
    intervalUnit: 'minutes',
    runImmediately: false,
  },
  subscriptions: [] as string[],
})

// Errors
const errors = ref({
  name: '',
  event: '',
  path: '',
  cron: '',
  intervalValue: '',
})

const creating = ref(false)

// Trigger types
const triggerTypes = [
  {
    value: 'event',
    label: 'Event Trigger',
    icon: 'i-lucide-radio',
    description: 'Trigger flows when specific events are published',
    scope: 'flow',
    useCase: 'Event-driven workflows',
  },
  {
    value: 'webhook',
    label: 'Webhook Trigger',
    icon: 'i-lucide-webhook',
    description: 'Trigger flows via HTTP requests',
    scope: 'flow',
    useCase: 'External integrations',
  },
  {
    value: 'schedule',
    label: 'Schedule Trigger',
    icon: 'i-lucide-clock',
    description: 'Trigger flows on a time-based schedule',
    scope: 'flow',
    useCase: 'Recurring tasks',
  },
  {
    value: 'manual',
    label: 'Manual Trigger',
    icon: 'i-lucide-hand',
    description: 'Trigger flows manually via UI or API',
    scope: 'flow',
    useCase: 'On-demand execution',
  },
]

// Available flows
const availableFlows = computed(() => flows.value || [])

// Methods
const selectType = (type: string) => {
  formData.value.type = type as any
}

const nextStep = () => {
  if (validateStep(currentStep.value)) {
    currentStep.value++
  }
}

const previousStep = () => {
  currentStep.value--
}

const validateStep = (step: number): boolean => {
  errors.value = {
    name: '',
    event: '',
    path: '',
    cron: '',
    intervalValue: '',
  }

  if (step === 2) {
    if (!formData.value.name) {
      errors.value.name = 'Trigger name is required'
      return false
    }
    if (!/^[a-z0-9-]+$/.test(formData.value.name)) {
      errors.value.name = 'Use lowercase letters, numbers, and hyphens only'
      return false
    }
  }

  if (step === 3) {
    if (formData.value.type === 'event' && !formData.value.config.event) {
      errors.value.event = 'Event name is required'
      return false
    }
    if (formData.value.type === 'webhook' && !formData.value.config.path) {
      errors.value.path = 'Webhook path is required'
      return false
    }
    if (formData.value.type === 'schedule') {
      if (formData.value.config.scheduleType === 'cron' && !formData.value.config.cron) {
        errors.value.cron = 'Cron expression is required'
        return false
      }
      if (formData.value.config.scheduleType === 'interval' && !formData.value.config.intervalValue) {
        errors.value.intervalValue = 'Interval value is required'
        return false
      }
    }
  }

  return true
}

const toggleFlow = (flowId: string) => {
  const index = formData.value.subscriptions.indexOf(flowId)
  if (index >= 0) {
    formData.value.subscriptions.splice(index, 1)
  }
  else {
    formData.value.subscriptions.push(flowId)
  }
}

const getReviewConfig = () => {
  const config: any = {}
  
  if (formData.value.type === 'event') {
    config.event = formData.value.config.event
    if (formData.value.config.filter) {
      try {
        config.filter = JSON.parse(formData.value.config.filter)
      }
      catch {
        config.filter = formData.value.config.filter
      }
    }
  }
  else if (formData.value.type === 'webhook') {
    config.method = formData.value.config.method
    config.path = formData.value.config.path
    if (formData.value.config.requireAuth) {
      config.requireAuth = true
      config.authHeader = formData.value.config.authHeader
    }
  }
  else if (formData.value.type === 'schedule') {
    if (formData.value.config.scheduleType === 'cron') {
      config.cron = formData.value.config.cron
    }
    else {
      config.interval = `${formData.value.config.intervalValue} ${formData.value.config.intervalUnit}`
    }
    config.runImmediately = formData.value.config.runImmediately
  }

  return config
}

const createTrigger = async () => {
  try {
    creating.value = true

    const payload = {
      name: formData.value.name,
      displayName: formData.value.displayName || formData.value.name,
      description: formData.value.description,
      type: formData.value.type,
      scope: getTriggerScope(formData.value.type),
      config: getReviewConfig(),
      subscriptions: formData.value.subscriptions,
    }

    await $fetch('/api/_triggers', {
      method: 'POST',
      body: payload,
    })

    // Navigate back to triggers list
    router.push('/triggers')
  }
  catch (err) {
    console.error('Failed to create trigger:', err)
    alert('Failed to create trigger: ' + (err instanceof Error ? err.message : String(err)))
  }
  finally {
    creating.value = false
  }
}

// Helper functions
const getTriggerTypeIcon = (type: string) => {
  return triggerTypes.find(t => t.value === type)?.icon || 'i-lucide-zap'
}

const getTriggerTypeLabel = (type: string) => {
  return triggerTypes.find(t => t.value === type)?.label || type
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

const getTriggerTypeBgClass = (type: string) => {
  switch (type) {
    case 'event': return 'bg-blue-100 dark:bg-blue-900/40'
    case 'webhook': return 'bg-purple-100 dark:bg-purple-900/40'
    case 'schedule': return 'bg-emerald-100 dark:bg-emerald-900/40'
    case 'manual': return 'bg-amber-100 dark:bg-amber-900/40'
    default: return 'bg-gray-100 dark:bg-gray-800'
  }
}

const getTriggerTypeIconClass = (type: string) => {
  switch (type) {
    case 'event': return 'text-blue-600 dark:text-blue-400'
    case 'webhook': return 'text-purple-600 dark:text-purple-400'
    case 'schedule': return 'text-emerald-600 dark:text-emerald-400'
    case 'manual': return 'text-amber-600 dark:text-amber-400'
    default: return 'text-gray-600 dark:text-gray-400'
  }
}

const getTriggerScope = (type: string) => {
  return triggerTypes.find(t => t.value === type)?.scope || 'flow'
}
</script>
