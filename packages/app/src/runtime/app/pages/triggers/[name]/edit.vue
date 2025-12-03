<template>
  <ClientOnly>
    <template #fallback>
      <div class="h-full flex items-center justify-center">
        <div class="text-center">
          <UIcon
            name="i-lucide-loader-2"
            class="w-8 h-8 animate-spin mx-auto mb-3 text-gray-400"
          />
          <p class="text-sm text-gray-500 dark:text-gray-400">
            Loading...
          </p>
        </div>
      </div>
    </template>
    <div class="h-full flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
      <!-- Header -->
      <NventTriggerEditHeader
        :is-saving="isSaving"
        :has-changes="hasChanges"
        @back="goBack"
        @cancel="goBack"
        @save="handleSave"
      />

      <!-- Loading State -->
      <div
        v-if="status === 'pending' && !trigger"
        class="flex-1 flex items-center justify-center"
      >
        <div class="text-center">
          <UIcon
            name="i-lucide-loader-2"
            class="w-8 h-8 animate-spin mx-auto mb-3 text-gray-400"
          />
          <p class="text-sm text-gray-500 dark:text-gray-400">
            Loading trigger...
          </p>
        </div>
      </div>

      <!-- Error State -->
      <div
        v-else-if="!trigger"
        class="flex-1 flex items-center justify-center"
      >
        <div class="text-center">
          <UIcon
            name="i-lucide-alert-circle"
            class="w-12 h-12 mx-auto mb-3 text-red-400"
          />
          <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
            Trigger not found
          </h2>
          <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
            The trigger you're looking for doesn't exist.
          </p>
          <UButton
            color="neutral"
            @click="goBack"
          >
            Go Back
          </UButton>
        </div>
      </div>

      <!-- Main Content -->
      <div
        v-else
        class="flex-1 overflow-y-auto p-6"
      >
        <div class="max-w-4xl mx-auto">
          <!-- Error Alert -->
          <UAlert
            v-if="saveError"
            color="error"
            variant="subtle"
            :title="saveError"
            :close-button="{ icon: 'i-lucide-x' }"
            @close="saveError = null"
          />

          <!-- Success Alert -->
          <UAlert
            v-if="saveSuccess"
            color="success"
            variant="subtle"
            title="Trigger updated successfully"
            :close-button="{ icon: 'i-lucide-x' }"
            @close="saveSuccess = false"
          />

          <!-- Main Form -->
          <UForm
            ref="form"
            :schema="currentSchema"
            :state="formState"
            class="space-y-6"
            @submit="onSubmit"
            @error="onError"
          >
            <!-- Basic Information -->
            <NventTriggerBasicInfoCard
              v-model="formState"
              is-edit
            />

            <!-- Status Control -->
            <NventTriggerStatusConfig
              v-model="formState.status"
              nested
            />

            <!-- Type-Specific Configuration -->
            <NventTriggerWebhookConfig
              v-if="formState.type === 'webhook'"
              v-model="formState.webhook"
              name="webhook"
            />

            <NventTriggerScheduleConfig
              v-if="formState.type === 'schedule'"
              v-model="formState.schedule"
              name="schedule"
            />

            <NventTriggerEventConfig
              v-if="formState.type === 'event'"
              v-model="formState.config"
              name="config"
            />

            <!-- Flow Subscriptions -->
            <NventTriggerFlowSubscriptions
              :subscriptions="formState.subscriptions"
              :flows="flows"
              @toggle="toggleFlowSubscription"
            />
          </UForm>

          <!-- Danger Zone -->
          <NventTriggerDangerZone
            class="mt-6"
            :is-deleting="isDeleting"
            @delete="handleDelete"
          />
        </div>
      </div>
    </div>

    <!-- Delete Confirmation Dialog -->
    <ConfirmDialog
      v-model:open="showDeleteDialog"
      title="Delete Trigger"
      :description="`Are you sure you want to delete the trigger '${trigger?.displayName || trigger?.name}'?`"
      :items="[
        'All subscriptions will be removed',
        'Event history will be preserved',
        'This action cannot be undone',
      ]"
      warning="This is a permanent action."
      confirm-label="Delete Trigger"
      confirm-color="error"
      icon="i-lucide-alert-triangle"
      icon-color="error"
      :loading="isDeleting"
      @confirm="confirmDelete"
      @cancel="showDeleteDialog = false"
    />
  </ClientOnly>
</template>

<script setup lang="ts">
import { ref, computed, watch, useToast } from '#imports'
import { useTrigger } from '../../../composables/useTrigger'
import { useAnalyzedFlows } from '../../../composables/useAnalyzedFlows'
import { useComponentRouter } from '../../../composables/useComponentRouter'
import ConfirmDialog from '../../../components/ConfirmDialog.vue'
import { z } from 'zod'
import type { FormErrorEvent, FormSubmitEvent } from '@nuxt/ui'

const router = useComponentRouter()
const toast = useToast()
const route = computed(() => {
  if (!router.route?.value?.path) return null
  const path = router.route.value.path
  const match = path.match(/\/triggers\/([^/]+)\/edit/)
  return match && match[1] ? decodeURIComponent(match[1]) : null
})

const triggerName = computed(() => route.value)

// Fetch trigger data
const { trigger, status, refresh } = useTrigger(triggerName)

// Fetch available flows
const flows = useAnalyzedFlows()

// Zod schemas for validation
const baseSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  displayName: z.string().min(1, 'Display name is required'),
  description: z.string(),
  type: z.enum(['event', 'webhook', 'schedule', 'manual']),
  scope: z.enum(['flow', 'run']),
  subscriptions: z.array(z.string()),
})

const webhookSchema = baseSchema.extend({
  webhook: z.object({
    path: z.string().min(1, 'Webhook path is required'),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
    requireAuth: z.boolean(),
    authHeader: z.string().min(1, 'Auth header is required').optional(),
  }),
})

const scheduleSchema = baseSchema.extend({
  schedule: z.object({
    cron: z.string().optional(),
    interval: z.number().min(1, 'Interval must be at least 1 second').optional(),
    timezone: z.string().min(1, 'Timezone is required'),
    enabled: z.boolean(),
  }).refine(
    data => data.cron || data.interval,
    { message: 'Either cron expression or interval is required', path: ['cron'] },
  ),
})

const eventSchema = baseSchema.extend({
  config: z.object({
    event: z.string().min(1, 'Event name is required'),
    filter: z.string().optional(),
  }),
})

const manualSchema = baseSchema

// Current schema based on trigger type
const currentSchema = computed(() => {
  switch (formState.value.type) {
    case 'webhook': return webhookSchema
    case 'schedule': return scheduleSchema
    case 'event': return eventSchema
    default: return manualSchema
  }
})

// Form state
const formState = ref({
  name: '',
  displayName: '',
  description: '',
  type: 'event' as 'event' | 'webhook' | 'schedule' | 'manual',
  scope: 'flow' as 'flow' | 'run',
  status: 'active' as 'active' | 'inactive' | 'retired',
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
    enabled: true,
  },
  config: {
    event: '',
    filter: '',
  },
  subscriptions: [] as string[],
})

const form = ref()
const isSaving = ref(false)

// Initialize form state when trigger loads
// Skip updates during save to prevent form reset
watch(trigger, (newTrigger) => {
  if (newTrigger && !isSaving.value) {
    formState.value.name = newTrigger.name
    formState.value.displayName = newTrigger.displayName || newTrigger.name
    formState.value.description = newTrigger.description || ''
    formState.value.type = newTrigger.type
    formState.value.scope = newTrigger.scope
    formState.value.status = (newTrigger.status || 'active') as 'active' | 'inactive' | 'retired'

    if (newTrigger.webhook) {
      formState.value.webhook = {
        path: newTrigger.webhook.path || '',
        method: (newTrigger.webhook.method || 'POST') as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        requireAuth: !!newTrigger.webhook.auth,
        authHeader: newTrigger.webhook.auth?.header || 'X-API-Key',
      }
    }

    if (newTrigger.schedule) {
      formState.value.schedule = {
        cron: newTrigger.schedule.cron || '',
        interval: (newTrigger.schedule as any).interval,
        timezone: newTrigger.schedule.timezone || 'UTC',
        enabled: newTrigger.schedule.enabled ?? true,
      }
    }

    if (newTrigger.config) {
      formState.value.config = {
        event: newTrigger.config.event || '',
        filter: newTrigger.config.filter ? JSON.stringify(newTrigger.config.filter, null, 2) : '',
      }
    }

    // Deduplicate subscriptions in case of data inconsistency
    formState.value.subscriptions = Array.from(new Set(newTrigger.subscribedFlows || []))
  }
}, { immediate: true })

const toggleFlowSubscription = (flowName: string) => {
  const index = formState.value.subscriptions.indexOf(flowName)
  if (index === -1) {
    formState.value.subscriptions.push(flowName)
  }
  else {
    formState.value.subscriptions.splice(index, 1)
  }
}

// Watch for subscription changes to force hasChanges to update
const manualDirty = ref(false)
watch(() => formState.value.subscriptions, () => {
  manualDirty.value = true
}, { deep: true })

// Track changes - use form's dirty state plus manual checks
const hasChanges = computed(() => {
  // Use form's built-in dirty tracking
  if (form.value?.dirty || manualDirty.value) return true

  if (!trigger.value) return false

  // Additional checks for changes not tracked by form inputs
  return (
    formState.value.displayName !== (trigger.value.displayName || trigger.value.name)
    || formState.value.description !== (trigger.value.description || '')
    || formState.value.status !== (trigger.value.status || 'active')
    || JSON.stringify([...formState.value.subscriptions].sort()) !== JSON.stringify([...(trigger.value.subscribedFlows || [])].sort())
    || (trigger.value.type === 'webhook' && (
      formState.value.webhook.path !== (trigger.value.webhook?.path || '')
      || formState.value.webhook.method !== (trigger.value.webhook?.method || 'POST')
    ))
    || (trigger.value.type === 'schedule' && (
      formState.value.schedule.cron !== (trigger.value.schedule?.cron || '')
      || formState.value.schedule.interval !== (trigger.value.schedule as any)?.interval
      || formState.value.schedule.timezone !== (trigger.value.schedule?.timezone || 'UTC')
      || formState.value.schedule.enabled !== (trigger.value.schedule?.enabled ?? true)
    ))
    || (trigger.value.type === 'event' && (
      formState.value.config.event !== (trigger.value.config?.event || '')
      || formState.value.config.filter !== (trigger.value.config?.filter ? JSON.stringify(trigger.value.config.filter, null, 2) : '')
    ))
  )
})

// Form state
const saveError = ref<string | null>(null)
const saveSuccess = ref(false)

// Form submission handler
const onSubmit = async (event: FormSubmitEvent<any>) => {
  if (!trigger.value) return

  isSaving.value = true
  saveError.value = null
  saveSuccess.value = false

  try {
    const data = event.data
    const payload: any = {
      displayName: data.displayName,
      description: data.description,
      status: formState.value.status,
      subscriptions: formState.value.subscriptions, // Use formState directly for subscriptions
    }

    if (formState.value.type === 'webhook') {
      payload.config = {
        path: formState.value.webhook.path,
        method: formState.value.webhook.method,
        requireAuth: formState.value.webhook.requireAuth,
        authHeader: formState.value.webhook.authHeader,
      }
    }
    else if (formState.value.type === 'schedule') {
      payload.config = {
        cron: formState.value.schedule.cron || undefined,
        interval: formState.value.schedule.interval,
        timezone: formState.value.schedule.timezone,
        enabled: formState.value.schedule.enabled,
      }
    }
    else if (formState.value.type === 'event') {
      payload.config = {
        event: formState.value.config.event,
        filter: formState.value.config.filter || undefined,
      }
    }

    const response = await $fetch<{ error?: string }>(`/api/_triggers/${encodeURIComponent(trigger.value.name)}`, {
      method: 'PATCH',
      body: payload,
    })

    if (response.error) {
      saveError.value = response.error
      toast.add({ title: 'Error', description: response.error, color: 'error' })
    }
    else {
      saveSuccess.value = true
      toast.add({ title: 'Success', description: 'Trigger updated successfully', color: 'success' })

      // Wait for event processing to complete (events are async)
      await new Promise(resolve => setTimeout(resolve, 300))

      // Reset isSaving BEFORE refresh so watch can update the form
      isSaving.value = false

      // Now refresh to get updated data
      await refresh()

      // Reset dirty flags after refresh completes
      manualDirty.value = false
      if (form.value) {
        form.value.clear() // Clear form's internal dirty state
      }

      // Clear success message after 3 seconds
      setTimeout(() => {
        saveSuccess.value = false
      }, 3000)
    }
  }
  catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update trigger'
    saveError.value = message
    toast.add({ title: 'Error', description: message, color: 'error' })
    isSaving.value = false
  }
}

// Form error handler
const onError = (event: FormErrorEvent) => {
  if (event?.errors?.[0]) {
    const error = event.errors[0]
    toast.add({
      title: 'Validation Error',
      description: error.message || 'Please check your form inputs',
      color: 'error',
    })

    // Focus first error element
    if (error.id) {
      const element = document.getElementById(error.id)
      element?.focus()
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }
}

// Handle save button click from header
const handleSave = () => {
  form.value?.submit()
}

// Delete state
const isDeleting = ref(false)
const showDeleteDialog = ref(false)

const handleDelete = () => {
  showDeleteDialog.value = true
}

const confirmDelete = async () => {
  if (!trigger.value) return

  isDeleting.value = true
  saveError.value = null

  try {
    const response = await $fetch<{ error?: string }>(`/api/_triggers/${encodeURIComponent(trigger.value.name)}`, {
      method: 'DELETE',
    })

    if (response.error) {
      saveError.value = response.error
      showDeleteDialog.value = false
    }
    else {
      toast.add({ title: 'Success', description: 'Trigger deleted successfully', color: 'success' })
      showDeleteDialog.value = false

      // Wait a bit for user to see the success message, then navigate
      setTimeout(() => {
        router.push('/triggers')
      }, 500)
    }
  }
  catch (err) {
    saveError.value = err instanceof Error ? err.message : 'Failed to delete trigger'
    showDeleteDialog.value = false
  }
  finally {
    isDeleting.value = false
  }
}

const goBack = () => {
  router.push(`/triggers/${encodeURIComponent(trigger.value?.name || '')}`)
}
</script>
