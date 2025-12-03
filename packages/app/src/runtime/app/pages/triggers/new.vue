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
        <UForm
          ref="form"
          :schema="currentStepSchema"
          :state="formState"
          class="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm"
        >
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
                  :class="formState.type === type.value
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-950/30'
                    : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700'"
                  @click="selectType(type.value)"
                >
                  <div class="flex items-start gap-4">
                    <div
                      class="w-12 h-12 rounded-lg flex items-center justify-center shrink-0 transition-colors"
                      :class="formState.type === type.value
                        ? 'bg-primary-100 dark:bg-primary-900/40'
                        : 'bg-gray-100 dark:bg-gray-800 group-hover:bg-gray-200 dark:group-hover:bg-gray-700'"
                    >
                      <UIcon
                        :name="type.icon"
                        class="w-6 h-6"
                        :class="formState.type === type.value ? 'text-primary-600 dark:text-primary-400' : 'text-gray-600 dark:text-gray-400'"
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
                      v-if="formState.type === type.value"
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
            <div class="p-6">
              <BasicInfoCard
                v-model="formState"
                no-card
              />
            </div>
          </div>

          <!-- Step 3: Configuration -->
          <div v-show="currentStep === 3">
            <div class="p-6 border-b border-gray-200 dark:border-gray-800">
              <div class="flex items-center gap-3 mb-2">
                <div
                  class="w-10 h-10 rounded-lg flex items-center justify-center"
                  :class="getTriggerTypeBgClass(formState.type)"
                >
                  <UIcon
                    :name="getTriggerTypeIcon(formState.type)"
                    class="w-5 h-5"
                    :class="getTriggerTypeIconClass(formState.type)"
                  />
                </div>
                <div>
                  <h2 class="text-xl font-semibold">
                    {{ getTriggerTypeLabel(formState.type) }} Configuration
                  </h2>
                  <p class="text-sm text-gray-500 dark:text-gray-400">
                    Configure the specific settings for this trigger type
                  </p>
                </div>
              </div>
            </div>
            <div class="p-6">
              <!-- Event Config -->
              <EventConfig
                v-if="formState.type === 'event'"
                v-model="formState.config"
                no-card
                name="config"
              />

              <!-- Webhook Config -->
              <WebhookConfig
                v-if="formState.type === 'webhook'"
                v-model="formState.webhook"
                no-card
                name="webhook"
              />

              <!-- Schedule Config -->
              <ScheduleConfig
                v-if="formState.type === 'schedule'"
                v-model="formState.schedule"
                no-card
                name="schedule"
              />

              <!-- Manual Trigger Info -->
              <div
                v-if="formState.type === 'manual'"
                class="p-4 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800"
              >
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
            </div>
          </div>

          <!-- Step 4: Flow Subscriptions -->
          <div v-show="currentStep === 4">
            <div class="p-6">
              <FlowSubscriptions
                :subscriptions="formState.subscriptions"
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
                    :class="getTriggerTypeBgClass(formState.type)"
                  >
                    <UIcon
                      :name="getTriggerTypeIcon(formState.type)"
                      class="w-6 h-6"
                      :class="getTriggerTypeIconClass(formState.type)"
                    />
                  </div>
                  <div class="flex-1 min-w-0">
                    <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
                      {{ formState.displayName || formState.name }}
                    </h3>
                    <p
                      v-if="formState.description"
                      class="text-sm text-gray-600 dark:text-gray-400"
                    >
                      {{ formState.description }}
                    </p>
                    <div class="flex items-center gap-2 mt-2">
                      <UBadge
                        :label="getTriggerTypeLabel(formState.type)"
                        :color="getTriggerTypeColor(formState.type)"
                        variant="subtle"
                      />
                      <UBadge
                        :label="getTriggerScope(formState.type)"
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
                      {{ formState.name }}
                    </p>
                  </div>
                  <div>
                    <p class="text-xs text-gray-500 dark:text-gray-400 mb-1">
                      Subscriptions
                    </p>
                    <p class="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {{ formState.subscriptions.length }} flow{{ formState.subscriptions.length === 1 ? '' : 's' }}
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
              <div v-if="formState.subscriptions.length > 0">
                <h4 class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                  Subscribed Flows ({{ formState.subscriptions.length }})
                </h4>
                <div class="space-y-2">
                  <div
                    v-for="flowId in formState.subscriptions"
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
        </UForm>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, useToast } from '#imports'
import { useComponentRouter } from '../../composables/useComponentRouter'
import { useAnalyzedFlows } from '../../composables/useAnalyzedFlows'
import { z } from 'zod'
import BasicInfoCard from '../../components/trigger/BasicInfoCard.vue'
import WebhookConfig from '../../components/trigger/WebhookConfig.vue'
import ScheduleConfig from '../../components/trigger/ScheduleConfig.vue'
import EventConfig from '../../components/trigger/EventConfig.vue'
import FlowSubscriptions from '../../components/trigger/FlowSubscriptions.vue'

const router = useComponentRouter()
const flows = useAnalyzedFlows()
const toast = useToast()

// Stepper state
const currentStep = ref(1)
const steps = [
  { key: 1, label: 'Type', icon: 'i-lucide-sparkles' },
  { key: 2, label: 'Info', icon: 'i-lucide-file-text' },
  { key: 3, label: 'Config', icon: 'i-lucide-settings' },
  { key: 4, label: 'Flows', icon: 'i-lucide-git-branch' },
  { key: 5, label: 'Review', icon: 'i-lucide-check-circle' },
]

// Parent form doesn't need a schema - nested forms handle their own validation
const currentStepSchema = computed(() => z.object({}))

// Form state
const formState = ref({
  type: 'event' as 'event' | 'webhook' | 'schedule' | 'manual',
  scope: 'flow' as 'flow' | 'run',
  status: 'active' as 'active' | 'inactive' | 'retired',
  name: '',
  displayName: '',
  description: '',
  webhook: {
    path: '',
    method: 'POST' as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    requireAuth: false,
    authHeader: 'X-API-Key',
  },
  schedule: {
    cron: '',
    interval: undefined as number | undefined,
    timezone: 'UTC',
  },
  config: {
    event: '',
    filter: '',
  },
  subscriptions: [] as string[],
})

const form = ref()
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
  formState.value.type = type as any
  formState.value.scope = (getTriggerScope(type) || 'flow') as 'flow' | 'run'
}

const nextStep = async () => {
  // Validate steps that require validation
  if ((currentStep.value === 2 || currentStep.value === 3) && form.value) {
    try {
      await form.value.validate()
      currentStep.value++
    }
    catch {
      // Validation failed, errors are already displayed by UForm
    }
  }
  else {
    currentStep.value++
  }
}

const previousStep = () => {
  currentStep.value--
}

const toggleFlow = (flowId: string) => {
  const index = formState.value.subscriptions.indexOf(flowId)
  if (index >= 0) {
    formState.value.subscriptions.splice(index, 1)
  }
  else {
    formState.value.subscriptions.push(flowId)
  }
}

const getReviewConfig = () => {
  const config: any = {}

  if (formState.value.type === 'event') {
    config.event = formState.value.config.event
    if (formState.value.config.filter) {
      try {
        config.filter = JSON.parse(formState.value.config.filter)
      }
      catch {
        config.filter = formState.value.config.filter
      }
    }
  }
  else if (formState.value.type === 'webhook') {
    config.path = formState.value.webhook.path
    config.method = formState.value.webhook.method
    if (formState.value.webhook.requireAuth) {
      config.requireAuth = true
      config.authHeader = formState.value.webhook.authHeader
    }
  }
  else if (formState.value.type === 'schedule') {
    // Schedule config goes at top level
    if (formState.value.schedule.cron) {
      config.cron = formState.value.schedule.cron
    }
    if (formState.value.schedule.interval) {
      config.interval = formState.value.schedule.interval
    }
    config.timezone = formState.value.schedule.timezone
  }

  return config
}

const createTrigger = async () => {
  try {
    creating.value = true

    const config = getReviewConfig()

    // Additional validation for schedule triggers
    if (formState.value.type === 'schedule') {
      if (!config.cron && !config.interval) {
        toast.add({
          title: 'Validation Error',
          description: 'Schedule triggers require either a cron expression or an interval',
          color: 'error',
          icon: 'i-lucide-alert-circle',
        })
        return
      }
    }

    const payload = {
      name: formState.value.name,
      displayName: formState.value.displayName || formState.value.name,
      description: formState.value.description,
      type: formState.value.type,
      scope: formState.value.scope,
      status: formState.value.status,
      config,
      subscriptions: formState.value.subscriptions,
    }

    const response = await $fetch('/api/_triggers', {
      method: 'POST',
      body: payload,
    })

    // Check if response contains an error
    if (response && typeof response === 'object' && 'error' in response) {
      toast.add({
        title: 'Failed to create trigger',
        description: response.error as string,
        color: 'error',
        icon: 'i-lucide-alert-circle',
      })
      return
    }

    // Success
    toast.add({
      title: 'Trigger created',
      description: `Successfully created trigger '${formState.value.displayName || formState.value.name}'`,
      color: 'success',
      icon: 'i-lucide-check-circle',
    })

    // Navigate back to triggers list
    router.push('/triggers')
  }
  catch (err) {
    console.error('Failed to create trigger:', err)

    // Extract error message
    let errorMessage = 'An unexpected error occurred'
    if (err && typeof err === 'object') {
      if ('data' in err && err.data && typeof err.data === 'object') {
        if ('error' in err.data) {
          errorMessage = err.data.error as string
        }
        else if ('message' in err.data) {
          errorMessage = err.data.message as string
        }
      }
      else if ('message' in err) {
        errorMessage = err.message as string
      }
    }

    toast.add({
      title: 'Failed to create trigger',
      description: errorMessage,
      color: 'error',
      icon: 'i-lucide-alert-circle',
    })
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
