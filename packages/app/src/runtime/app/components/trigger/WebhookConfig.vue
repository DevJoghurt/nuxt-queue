<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-webhook"
          class="w-5 h-5 text-purple-500"
        />
        <h2 class="text-lg font-semibold">
          Webhook Configuration
        </h2>
      </div>
    </template>

    <UForm
      :state="config"
      class="space-y-4"
    >
      <UFormField
        label="Webhook Path"
        name="path"
        required
      >
        <template #hint>
          <span class="text-xs text-gray-500">The URL path where this webhook will listen</span>
        </template>
        <UInput
          :model-value="config.path"
          @update:model-value="$emit('update:path', $event)"
          placeholder="/webhooks/my-trigger"
          icon="i-lucide-link"
        />
      </UFormField>

      <UFormField
        label="HTTP Method"
        name="method"
      >
        <template #hint>
          <span class="text-xs text-gray-500">The HTTP method to accept</span>
        </template>
        <USelectMenu
          :model-value="config.method"
          @update:model-value="$emit('update:method', $event)"
          :items="['GET', 'POST', 'PUT', 'PATCH', 'DELETE']"
          placeholder="Select method"
        />
      </UFormField>

      <UFormField
        label="Authentication"
        name="auth"
      >
        <ClientOnly>
          <UCheckbox
            :model-value="config.requireAuth"
            @update:model-value="$emit('update:requireAuth', $event)"
            label="Require authentication"
          />
        </ClientOnly>
      </UFormField>

      <UFormField
        v-if="config.requireAuth"
        label="Auth Header Name"
        name="authHeader"
      >
        <template #hint>
          <span class="text-xs text-gray-500">The header name to check for authentication</span>
        </template>
        <UInput
          :model-value="config.authHeader"
          @update:model-value="$emit('update:authHeader', $event)"
          placeholder="X-API-Key"
          icon="i-lucide-key"
        />
      </UFormField>
    </UForm>
  </UCard>
</template>

<script setup lang="ts">
defineProps<{
  config: {
    path: string
    method: string
    requireAuth: boolean
    authHeader: string
  }
}>()

defineEmits<{
  'update:path': [value: string]
  'update:method': [value: string]
  'update:requireAuth': [value: boolean]
  'update:authHeader': [value: string]
}>()
</script>
