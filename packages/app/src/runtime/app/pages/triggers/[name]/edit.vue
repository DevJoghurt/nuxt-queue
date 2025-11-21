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
        <div class="max-w-4xl mx-auto space-y-6">
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

          <!-- Basic Information -->
          <NventTriggerBasicInfoCard :form-state="formState" />

          <!-- Type-Specific Configuration -->
          <NventTriggerWebhookConfig
            v-if="formState.type === 'webhook'"
            :config="formState.webhook"
            @update:path="formState.webhook.path = $event"
            @update:method="formState.webhook.method = $event"
            @update:require-auth="formState.webhook.requireAuth = $event"
            @update:auth-header="formState.webhook.authHeader = $event"
          />

          <NventTriggerScheduleConfig
            v-if="formState.type === 'schedule'"
            :config="formState.schedule"
            @update:cron="formState.schedule.cron = $event"
            @update:interval="formState.schedule.interval = $event"
            @update:timezone="formState.schedule.timezone = $event"
            @update:enabled="formState.schedule.enabled = $event"
          />

          <NventTriggerEventConfig
            v-if="formState.type === 'event'"
            :config="formState.config"
            @update:event="formState.config.event = $event"
            @update:filter="formState.config.filter = $event"
          />

          <!-- Flow Subscriptions -->
          <NventTriggerFlowSubscriptions
            :subscriptions="formState.subscriptions"
            :flows="flows"
            @toggle="toggleFlowSubscription"
          />

          <!-- Danger Zone -->
          <NventTriggerDangerZone
            :is-deleting="isDeleting"
            @delete="handleDelete"
          />
        </div>
      </div>
    </div>
  </ClientOnly>
</template>

<script setup lang="ts">
import { ref, computed, watch } from '#imports'
import { useTrigger } from '../../../composables/useTrigger'
import { useAnalyzedFlows } from '../../../composables/useAnalyzedFlows'
import { useComponentRouter } from '../../../composables/useComponentRouter'

const router = useComponentRouter()
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

// Form state
const formState = ref({
  name: '',
  displayName: '',
  description: '',
  type: 'event' as 'event' | 'webhook' | 'schedule' | 'manual',
  scope: 'flow' as 'flow' | 'run',
  webhook: {
    path: '',
    method: 'POST',
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

// Initialize form state when trigger loads
watch(trigger, (newTrigger) => {
  if (newTrigger) {
    formState.value.name = newTrigger.name
    formState.value.displayName = newTrigger.displayName || newTrigger.name
    formState.value.description = newTrigger.description || ''
    formState.value.type = newTrigger.type
    formState.value.scope = newTrigger.scope

    if (newTrigger.webhook) {
      formState.value.webhook = {
        path: newTrigger.webhook.path || '',
        method: newTrigger.webhook.method || 'POST',
        requireAuth: !!newTrigger.webhook.auth,
        authHeader: newTrigger.webhook.auth?.header || 'X-API-Key',
      }
    }

    if (newTrigger.schedule) {
      formState.value.schedule = {
        cron: newTrigger.schedule.cron || '',
        interval: newTrigger.schedule.interval,
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

    formState.value.subscriptions = newTrigger.subscribedFlows || []
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

// Track changes
const hasChanges = computed(() => {
  if (!trigger.value) return false

  return (
    formState.value.displayName !== (trigger.value.displayName || trigger.value.name)
    || formState.value.description !== (trigger.value.description || '')
    || JSON.stringify([...formState.value.subscriptions].sort()) !== JSON.stringify([...(trigger.value.subscribedFlows || [])].sort())
    || (trigger.value.type === 'webhook' && (
      formState.value.webhook.path !== (trigger.value.webhook?.path || '')
      || formState.value.webhook.method !== (trigger.value.webhook?.method || 'POST')
    ))
    || (trigger.value.type === 'schedule' && (
      formState.value.schedule.cron !== (trigger.value.schedule?.cron || '')
      || formState.value.schedule.interval !== trigger.value.schedule?.interval
      || formState.value.schedule.timezone !== (trigger.value.schedule?.timezone || 'UTC')
      || formState.value.schedule.enabled !== (trigger.value.schedule?.enabled ?? true)
    ))
    || (trigger.value.type === 'event' && (
      formState.value.config.event !== (trigger.value.config?.event || '')
      || formState.value.config.filter !== (trigger.value.config?.filter ? JSON.stringify(trigger.value.config.filter, null, 2) : '')
    ))
  )
})

// Save state
const isSaving = ref(false)
const saveError = ref<string | null>(null)
const saveSuccess = ref(false)

const handleSave = async () => {
  if (!trigger.value || !hasChanges.value) return

  isSaving.value = true
  saveError.value = null
  saveSuccess.value = false

  try {
    const payload: any = {
      displayName: formState.value.displayName,
      description: formState.value.description,
      subscriptions: formState.value.subscriptions,
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
        filter: formState.value.config.filter ? formState.value.config.filter : undefined,
      }
    }

    const response = await $fetch(`/api/_triggers/${encodeURIComponent(trigger.value.name)}`, {
      method: 'PATCH',
      body: payload,
    })

    if (response.error) {
      saveError.value = response.error
    }
    else {
      saveSuccess.value = true
      await refresh()

      // Clear success message after 3 seconds
      setTimeout(() => {
        saveSuccess.value = false
      }, 3000)
    }
  }
  catch (err) {
    saveError.value = err instanceof Error ? err.message : 'Failed to update trigger'
  }
  finally {
    isSaving.value = false
  }
}

// Delete state
const isDeleting = ref(false)

const handleDelete = async () => {
  if (!trigger.value) return

  const confirmed = confirm(`Are you sure you want to delete the trigger "${trigger.value.displayName || trigger.value.name}"? This action cannot be undone.`)
  if (!confirmed) return

  isDeleting.value = true
  saveError.value = null

  try {
    const response = await $fetch(`/api/_triggers/${encodeURIComponent(trigger.value.name)}`, {
      method: 'DELETE',
    })

    if (response.error) {
      saveError.value = response.error
    }
    else {
      // Navigate back to triggers list
      router.push('/triggers')
    }
  }
  catch (err) {
    saveError.value = err instanceof Error ? err.message : 'Failed to delete trigger'
  }
  finally {
    isDeleting.value = false
  }
}

const goBack = () => {
  if (hasChanges.value) {
    const confirmed = confirm('You have unsaved changes. Are you sure you want to leave?')
    if (!confirmed) return
  }
  router.push(`/triggers/${encodeURIComponent(trigger.value?.name || '')}`)
}
</script>
